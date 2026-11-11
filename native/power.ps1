# Power helper: battery + AC, Windows 11 power mode, display brightness (WMI, unchanged from Phase 1).
. (Join-Path $PSScriptRoot 'lib\common.ps1')
Import-LiSource 'Power.cs'
$script:lastBri = ''
# @{ value = 0..100 | $null; error = $null | 'why' }. value $null with error $null means Windows has no brightness controller (desktop / external monitor).
function Get-Bri {
  try { $b = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1; if ($b) { return @{ value = [int]$b.CurrentBrightness; error = $null } }; return @{ value = $null; error = $null } }
  catch { $f = Get-LiFault $_.Exception; [Console]::Error.WriteLine('brightness query failed: ' + $f.message); return @{ value = $null; error = $f.message } }
}
function Send-Bri($force) { $b = Get-Bri; $key = "$($b.value)|$($b.error)"; if ($force -or $key -ne $script:lastBri) { $script:lastBri = $key; Send-LiEvent 'brightness' $b } }

try { [LiPower]::Init() } catch { [Console]::Error.WriteLine('power init failed: ' + $_.Exception.Message) }
[LiPower]::EmitBattery($true); [LiPower]::EmitMode($true); Send-Bri $true
# brightness changes (Fn keys, Settings, other apps) raise a WMI event on laptops with a built-in panel
try { Register-CimIndicationEvent -Namespace root/wmi -ClassName WmiMonitorBrightnessEvent -SourceIdentifier 'li.bri' | Out-Null } catch { }

Start-LiLoop -OnCommand {
  param($c)
  switch ($c.cmd) {
    'get'           { $b = Get-Bri; return @{ battery = (ConvertFrom-Json ([LiPower]::BatteryJson())); powermode = (ConvertFrom-Json ([LiPower]::ModeJson())); brightness = $b.value; brightnessError = $b.error } }
    'setMode'       { [LiPower]::SetMode([string]$c.mode); return $true }
    'setBrightness' {
      $v = [byte][Math]::Max(0, [Math]::Min(100, [int]$c.value))
      try { $m = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop | Select-Object -First 1 }
      catch { Throw-LiError 'wmi_failed' ('Windows refused access to the brightness controller: ' + (Get-LiFault $_.Exception).message) }
      if (-not $m) { Throw-LiError 'unsupported' 'This display does not support brightness control from Windows.' }
      try { Invoke-CimMethod -InputObject $m -MethodName WmiSetBrightness -Arguments @{ Timeout = 0; Brightness = $v } -ErrorAction Stop | Out-Null }
      catch { Throw-LiError 'wmi_failed' ('Windows rejected the brightness change: ' + (Get-LiFault $_.Exception).message) }
      return $true
    }
    default         { Throw-LiError 'unknown' ('Unknown command ' + $c.cmd) }
  }
} -OnEvent { param($e) if ($e.SourceIdentifier -eq 'li.bri') { Send-Bri $false } }
