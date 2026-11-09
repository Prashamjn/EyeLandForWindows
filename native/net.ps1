# Network helper: Wi-Fi (Native Wifi API, with WLAN change notifications) and Proton VPN observation.
# Wi-Fi radio state is read from the WLAN API and changes arrive as WLAN notifications (MSM radio_state_change): no WinRT event is needed,
# because Windows PowerShell cannot subscribe to WinRT events. Windows.Devices.Radios is only used to *change* the radio (a plain await).
. (Join-Path $PSScriptRoot 'lib\common.ps1')
Import-LiSource 'Wlan.cs'
. (Join-Path $PSScriptRoot 'lib\winrt.ps1')

$haveWlan = $false
try { $haveWlan = [LiWlan]::Init() } catch { [Console]::Error.WriteLine('wlan init failed: ' + (Get-LiFault $_.Exception).message) }
if (-not $haveWlan) { [Console]::Error.WriteLine('wlan unavailable: ' + [LiWlan]::InitError) }
try { [LiVpn]::Init() } catch { [Console]::Error.WriteLine('vpn init failed: ' + (Get-LiFault $_.Exception).message) }

# Windows Settings > Privacy > Location can hide the SSID from the WLAN API. The documented replacement is WlanConnectionProfileDetails.GetConnectedSsid.
function Get-WinRtSsid {
  try {
    $p = [Windows.Networking.Connectivity.NetworkInformation, Windows.Networking.Connectivity, ContentType = WindowsRuntime]::GetInternetConnectionProfile()
    if ($p -and $p.IsWlanConnectionProfile) { $n = [string]$p.WlanConnectionProfileDetails.GetConnectedSsid(); if ($n) { return $n } }
  } catch { [Console]::Error.WriteLine('winrt ssid lookup failed: ' + (Get-LiFault $_.Exception).message) }
  return $null
}

function Get-WifiState {
  $s = if ($haveWlan) { ConvertFrom-Json ([LiWlan]::StateJson()) } else { [pscustomobject]@{ adapter = $false; state = 'none'; ssid = $null; signal = 0; radio = 'unknown'; hardwareOff = $false } }
  $radioError = $null
  if (-not $s.adapter) {
    # Windows can drop the WLAN interface while the radio is switched off. Ask the radio API so the switch stays usable instead of claiming "no adapter".
    $r = Get-LiRadio 'WiFi'
    $s.radio = $r.state
    if ($r.error) { $radioError = $r.error }
    if ($r.state -eq 'off' -or $r.state -eq 'disabled') { $s.state = 'disconnected' }
  }
  if ($s.state -eq 'connected' -and -not $s.ssid) { $n = Get-WinRtSsid; if ($n) { $s.ssid = $n; $s.ssidError = $null } }
  $s | Add-Member -NotePropertyName radioError -NotePropertyValue $radioError -Force
  return $s
}

$script:lastWifi = ''
$emitWifi = { param([bool]$Force) $w = Get-WifiState; $j = ConvertTo-LiJson $w; if ($Force -or $j -ne $script:lastWifi) { $script:lastWifi = $j; Send-LiEvent 'wifi' $w } }
& $emitWifi $true
[LiVpn]::Emit($true)
Register-ObjectEvent -InputObject ([LiHub]::Instance) -EventName Signal -SourceIdentifier 'li.hub' | Out-Null

Start-LiLoop -OnCommand {
  param($c)
  switch ($c.cmd) {
    'get'        { return @{ wifi = (Get-WifiState); vpn = (ConvertFrom-Json ([LiVpn]::StateJson())) } }
    'networks'   { if (-not $haveWlan) { Throw-LiError 'no_adapter' ('Windows Wi-Fi service is not available: ' + [LiWlan]::InitError) }; return (ConvertFrom-Json ([LiWlan]::Networks([bool]$c.rescan))) }
    'connect'    {
      if (-not $haveWlan) { Throw-LiError 'no_adapter' ('Windows Wi-Fi service is not available: ' + [LiWlan]::InitError) }
      $null = [LiWlan]::Connect([string]$c.ssid, [string]$c.security, [string]$c.password, [bool]$c.known, [string]$c.profile)   # returns only after Windows confirmed it
      & $emitWifi $true; return (Get-WifiState)
    }
    'disconnect' { if (-not $haveWlan) { Throw-LiError 'no_adapter' 'Windows Wi-Fi service is not available.' }; [LiWlan]::Disconnect(); & $emitWifi $true; return (Get-WifiState) }
    'setRadio'   {
      $on = [bool]$c.on; $want = if ($on) { 'on' } else { 'off' }
      try { Set-LiRadio 'WiFi' $on | Out-Null }                         # 1st choice: Windows.Devices.Radios (checks the app's radio permission)
      catch {
        $first = Get-LiFault $_.Exception
        if (-not $haveWlan) { Throw-LiError $first.code $first.message }
        try { [void][LiWlan]::SetRadio($on) }                           # fallback: the WLAN API
        catch { $second = Get-LiFault $_.Exception; Throw-LiError $first.code ($first.message + ' The WLAN API could not do it either: ' + $second.message) }
      }
      $w = Get-WifiState
      if ($w.radio -ne $want) { Throw-LiError 'unverified' ("Windows still reports the Wi-Fi radio as '" + $w.radio + "'.") }
      & $emitWifi $true; return $w
    }
    'vpn'        { return (ConvertFrom-Json ([LiVpn]::StateJson())) }
    default      { Throw-LiError 'unknown' ('Unknown command ' + $c.cmd) }
  }
} -OnEvent {
  param($e)
  if ($e.SourceIdentifier -eq 'li.hub' -and $e.SourceEventArgs.Tag -eq 'wifi') { & $emitWifi $false }
}
