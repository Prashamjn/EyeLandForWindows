# Power helper: battery + AC, Windows 11 power mode, display brightness (WMI, unchanged from Phase 1).
. (Join-Path $PSScriptRoot 'lib\common.ps1')
Import-LiSource 'Power.cs'
$script:lastBri = -2
function Get-Bri { try { $b = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1; if ($b) { return [int]$b.CurrentBrightness } } catch { }; return $null }
function Send-Bri($force) { $v = Get-Bri; if ($force -or $v -ne $script:lastBri) { $script:lastBri = $v; Send-LiEvent 'brightness' @{ value = $v } } }

try { [LiPower]::Init() } catch { [Console]::Error.WriteLine('power init failed: ' + $_.Exception.Message) }
[LiPower]::EmitBattery($true); [LiPower]::EmitMode($true); Send-Bri $true
# brightness changes (Fn keys, Settings, other apps) raise a WMI event on laptops with a built-in panel
try { Register-CimIndicationEvent -Namespace root/wmi -ClassName WmiMonitorBrightnessEvent -SourceIdentifier 'li.bri' | Out-Null } catch { }

Start-LiLoop -OnCommand {
  param($c)
  switch ($c.cmd) {
    'get'           { return @{ battery = (ConvertFrom-Json ([LiPower]::BatteryJson())); powermode = (ConvertFrom-Json ([LiPower]::ModeJson())); brightness = (Get-Bri) } }
    'setMode'       { [LiPower]::SetMode([string]$c.mode); return $true }
    'setBrightness' {
      $v = [byte][Math]::Max(0, [Math]::Min(100, [int]$c.value))
      $m = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction SilentlyContinue | Select-Object -First 1
      if (-not $m) { Throw-LiError 'unsupported' 'This display does not support brightness control from Windows.' }
      Invoke-CimMethod -InputObject $m -MethodName WmiSetBrightness -Arguments @{ Timeout = 0; Brightness = $v } | Out-Null
      return $true
    }
    default         { Throw-LiError 'unknown' ('Unknown command ' + $c.cmd) }
  }
} -OnEvent { param($e) if ($e.SourceIdentifier -eq 'li.bri') { Send-Bri $false } }
