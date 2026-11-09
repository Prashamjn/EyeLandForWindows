# Shared bootstrap for the Liquid Island native helpers (audio.ps1, net.ps1, bt.ps1, power.ps1).
#  - compiles the C# in native\cs (Add-Type, C# 5)
#  - JSON-lines protocol on stdin/stdout (see native\cs\LiIO.cs)
#  - Start-LiLoop: blocks in Wait-Event, so an idle helper uses no CPU. stdin lines, WinRT events and WMI events all arrive as events.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

function Import-LiSource([string[]]$Files) {
  $paths = @(Join-Path $PSScriptRoot '..\cs\LiIO.cs') + ($Files | ForEach-Object { Join-Path $PSScriptRoot "..\cs\$_" })
  try { Add-Type -Path $paths -ErrorAction Stop }
  catch { [Console]::Error.WriteLine('Add-Type failed: ' + $_.Exception.Message); exit 2 }
}
function ConvertTo-LiJson($o) { ConvertTo-Json -InputObject $o -Compress -Depth 8 }
function Send-LiEvent([string]$Name, $Data) { [LiIO]::Event($Name, (ConvertTo-LiJson $Data)) }
function Send-LiReply($Id, [bool]$Ok, $Data, [string]$Err, [string]$Code) {
  $r = @{ rid = $Id; ok = $Ok }
  if ($Ok) { $r.data = $Data } else { $r.error = $Err; if ($Code) { $r.code = $Code } }
  [LiIO]::Write((ConvertTo-LiJson $r))
}

# $OnCommand: scriptblock param($cmd) -> returns data (throw to report an error). $OnEvent: scriptblock param($e) for other registered events.
function Start-LiLoop([scriptblock]$OnCommand, [scriptblock]$OnEvent) {
  $stdin = New-Object LiStdin
  Register-ObjectEvent -InputObject $stdin -EventName Received -SourceIdentifier 'li.in' | Out-Null
  Register-ObjectEvent -InputObject $stdin -EventName Closed -SourceIdentifier 'li.closed' | Out-Null
  $stdin.Start()
  [LiIO]::Event('ready', 'null')
  while ($true) {
    $e = Wait-Event
    Remove-Event -EventIdentifier $e.EventIdentifier -ErrorAction SilentlyContinue
    if ($e.SourceIdentifier -eq 'li.closed') { break }              # the app closed our stdin: exit, never linger as an orphan
    if ($e.SourceIdentifier -eq 'li.in') {
      $cmd = $null; $id = $null
      try {
        $cmd = $e.SourceEventArgs.Text | ConvertFrom-Json
        $id = $cmd.rid
        $data = & $OnCommand $cmd
        Send-LiReply $id $true $data '' ''
      } catch {
        $code = 'failed'; $msg = $_.Exception.Message
        if ($_.Exception -is [LiError]) { $code = $_.Exception.Code }
        Send-LiReply $id $false $null $msg $code                      # never echoes the request (it may hold a Wi-Fi password)
      }
    } elseif ($OnEvent) {
      try { & $OnEvent $e } catch { [Console]::Error.WriteLine('event handler: ' + $_.Exception.Message) }
    }
  }
}
function Throw-LiError([string]$Code, [string]$Msg) { throw (New-Object LiError($Code, $Msg)) }
