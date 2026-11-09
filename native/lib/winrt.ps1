# WinRT access from Windows PowerShell 5.1 (Windows.Devices.Radios / Enumeration / Bluetooth). Windows PowerShell only: pwsh 7 dropped WinRT projection.
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$script:asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($op, [Type]$resultType, [int]$timeoutMs = 20000) {
  $task = $script:asTaskGeneric.MakeGenericMethod($resultType).Invoke($null, @($op))
  if (-not $task.Wait($timeoutMs)) { Throw-LiError 'timeout' 'Windows did not respond in time.' }
  return $task.Result
}
[void][Windows.Devices.Radios.Radio, Windows.System.Devices, ContentType = WindowsRuntime]
[void][Windows.Devices.Radios.RadioAccessStatus, Windows.System.Devices, ContentType = WindowsRuntime]
[void][Windows.Devices.Radios.RadioState, Windows.System.Devices, ContentType = WindowsRuntime]

# 'on' | 'off' | 'unsupported' (no such radio) | 'denied' (Settings > Privacy blocks radio control)
function Get-LiRadio([string]$kind) {
  try {
    $access = Await ([Windows.Devices.Radios.Radio]::RequestAccessAsync()) ([Windows.Devices.Radios.RadioAccessStatus])
    $radios = Await ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]])
    $r = $radios | Where-Object { $_.Kind -eq $kind } | Select-Object -First 1
    if (-not $r) { return @{ state = 'unsupported'; radio = $null } }
    return @{ state = $(if ($r.State -eq 'On') { 'on' } else { 'off' }); radio = $r; denied = ($access -ne 'Allowed') }
  } catch { return @{ state = 'unsupported'; radio = $null } }
}
function Set-LiRadio([string]$kind, [bool]$on) {
  $info = Get-LiRadio $kind
  if ($info.state -eq 'unsupported') { Throw-LiError 'unsupported' "This PC has no $kind radio." }
  if ($info.denied) { Throw-LiError 'denied' 'Windows is blocking radio control for apps. Allow it in Settings > Privacy & security > Radios.' }
  $target = if ($on) { [Windows.Devices.Radios.RadioState]::On } else { [Windows.Devices.Radios.RadioState]::Off }
  $res = Await ($info.radio.SetStateAsync($target)) ([Windows.Devices.Radios.RadioAccessStatus])
  if ($res -ne 'Allowed') { Throw-LiError 'denied' 'Windows did not allow the change. Check Settings > Privacy & security > Radios.' }
  return $true
}
