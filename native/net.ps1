# Network helper: Wi-Fi (Native Wifi API + Windows.Devices.Radios for the on/off switch) and Proton VPN observation.
. (Join-Path $PSScriptRoot 'lib\common.ps1')
Import-LiSource 'Wlan.cs'
. (Join-Path $PSScriptRoot 'lib\winrt.ps1')

$haveWlan = $false
try { $haveWlan = [LiWlan]::Init() } catch { [Console]::Error.WriteLine('wlan init failed: ' + $_.Exception.Message) }
try { [LiVpn]::Init() } catch { [Console]::Error.WriteLine('vpn init failed: ' + $_.Exception.Message) }
$script:radioState = ''
# Radio.StateChanged is the event for the Wi-Fi switch (Settings, the keyboard key, or this app). The radio object must stay referenced.
$script:wifiRadio = (Get-LiRadio 'WiFi').radio
if ($script:wifiRadio) { try { Register-ObjectEvent -InputObject $script:wifiRadio -EventName StateChanged -SourceIdentifier 'li.wifiradio' | Out-Null } catch { [Console]::Error.WriteLine('radio events unavailable: ' + $_.Exception.Message) } }

function Get-WifiState {
  $r = Get-LiRadio 'WiFi'
  $s = if ($haveWlan) { ConvertFrom-Json ([LiWlan]::StateJson()) } else { [pscustomobject]@{ adapter = $false; state = 'none'; ssid = $null; signal = 0 } }
  $s | Add-Member -NotePropertyName radio -NotePropertyValue $r.state -Force
  return $s
}

$emitRadio = { $w = Get-WifiState; if ($w.radio -ne $script:radioState) { $script:radioState = $w.radio; Send-LiEvent 'wifi' $w } }
if ($haveWlan) { [LiWlan]::Emit($true) }
[LiVpn]::Emit($true)
& $emitRadio

Start-LiLoop -OnCommand {
  param($c)
  switch ($c.cmd) {
    'get'        { return @{ wifi = (Get-WifiState); vpn = (ConvertFrom-Json ([LiVpn]::StateJson())) } }
    'networks'   { if (-not $haveWlan) { Throw-LiError 'unsupported' 'No Wi-Fi adapter was found.' }; return @{ networks = @(ConvertFrom-Json ([LiWlan]::Networks([bool]$c.rescan))) } }
    'connect'    { if (-not $haveWlan) { Throw-LiError 'unsupported' 'No Wi-Fi adapter was found.' }; [LiWlan]::Connect([string]$c.ssid, [string]$c.security, [string]$c.password, [bool]$c.known); return $true }
    'disconnect' { if ($haveWlan) { [LiWlan]::Disconnect() }; return $true }
    'setRadio'   { Set-LiRadio 'WiFi' ([bool]$c.on) | Out-Null; & $emitRadio; return $true }
    'vpn'        { return (ConvertFrom-Json ([LiVpn]::StateJson())) }
    default      { Throw-LiError 'unknown' ('Unknown command ' + $c.cmd) }
  }
} -OnEvent {
  param($e)
  if ($e.SourceIdentifier -eq 'li.wifiradio') { & $emitRadio }
}
