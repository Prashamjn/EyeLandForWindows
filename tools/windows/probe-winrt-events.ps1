# Probe: can this PC subscribe to WinRT events from compiled C#? Run in Windows PowerShell 5.1:
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\windows\probe-winrt-events.ps1 -Seconds 20
# With -Seconds N it then waits N seconds and prints every event it receives: toggle Bluetooth in Quick Settings during that time.
param([int]$Seconds = 0)
$native = (Resolve-Path (Join-Path $PSScriptRoot '..\..\native')).Path
. (Join-Path $native 'lib\common.ps1')
Import-LiSource 'WinRtEvents.cs'
. (Join-Path $native 'lib\winrt.ps1')
Write-Host ('PowerShell ' + $PSVersionTable.PSVersion + ' / CLR ' + $PSVersionTable.CLRVersion)

$r = Get-LiRadio 'Bluetooth'
Write-Host ("Bluetooth radio: state=$($r.state) access=$($r.access) error=$($r.error)")
if ($r.radio) {
  $t = $r.radio.GetType()
  $ev = $t.GetEvent('StateChanged'); $add = $ev.GetAddMethod($true); $rem = $ev.GetRemoveMethod($true)
  Write-Host ('type: ' + $t.FullName)
  Write-Host ('add_StateChanged    : returns ' + $add.ReturnType.FullName + '  (' + (($add.GetParameters() | ForEach-Object { $_.ParameterType.Name }) -join ', ') + ')')
  Write-Host ('remove_StateChanged : (' + (($rem.GetParameters() | ForEach-Object { $_.ParameterType.Name }) -join ', ') + ')')
  $res = [LiWinRt]::Subscribe('probe', $r.radio, 'StateChanged')
  if ($res) { Write-Host ("STRATEGIES 1+2 (reflection): FAILED -> $res") } else { Write-Host 'STRATEGIES 1+2 (reflection): subscribed OK' }
} else { Write-Host 'no Bluetooth radio object: cannot probe the event' }

# Plan B, only informative: can Add-Type compile against the WinRT metadata directly?
try {
  $wm = Join-Path $env:windir 'System32\WinMetadata'
  $facade = [System.Reflection.Assembly]::Load('System.Runtime, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b03f5f7f11d50a3a').Location
  $refs = @('System.Runtime.WindowsRuntime', $facade, (Join-Path $wm 'Windows.Foundation.winmd'), (Join-Path $wm 'Windows.Devices.winmd'))
  Add-Type -ReferencedAssemblies $refs -TypeDefinition 'public static class LiProbeDirect { public static string Go() { Windows.Devices.Radios.Radio.GetRadiosAsync(); return "ok"; } }' -ErrorAction Stop
  Write-Host 'PLAN B (compile against .winmd): compiles'
} catch { Write-Host ('PLAN B (compile against .winmd): FAILED -> ' + $_.Exception.Message.Split("`n")[0]) }

if ($Seconds -gt 0 -and -not $res) {
  Register-ObjectEvent -InputObject ([LiHub]::Instance) -EventName Signal -SourceIdentifier 'probe.hub' | Out-Null
  Write-Host "Listening for $Seconds s. Toggle Bluetooth in Quick Settings now..."
  $end = [DateTime]::UtcNow.AddSeconds($Seconds); $n = 0
  while ([DateTime]::UtcNow -lt $end) {
    $e = Wait-Event -SourceIdentifier 'probe.hub' -Timeout 1
    if ($e) { $n++; $a = $e.SourceEventArgs; Write-Host ("EVENT tag=$($a.Tag) radio state=$($a.Extra)"); Remove-Event -EventIdentifier $e.EventIdentifier }
  }
  Write-Host ("$n event(s) received" + $(if ($n -eq 0) { ' (toggle Bluetooth during the window to test delivery)' } else { ': WinRT events work' }))
}
