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

$script:radioCache = @{}
$script:radioAccess = $null
function ConvertTo-LiRadioState($st) { switch ([string]$st) { 'On' { 'on' } 'Off' { 'off' } 'Disabled' { 'disabled' } default { 'unknown' } } }

# Returns @{ state; radio; access; error; code; detail }
#   state: 'on' | 'off' | 'disabled' | 'unknown'   the real state reported by Windows
#          'unsupported'                            enumeration worked and Windows lists no such radio
#          'error'                                  the query itself failed: error/code/detail say why (never disguised as "unsupported")
#   access: Allowed | DeniedByUser | DeniedBySystem | Unspecified. Reading works regardless; only changing needs Allowed.
function Get-LiRadio([string]$kind, [switch]$Refresh, [switch]$NewAccess) {
  try {
    if ($NewAccess -or -not $script:radioAccess) { $script:radioAccess = [string](Await ([Windows.Devices.Radios.Radio]::RequestAccessAsync()) ([Windows.Devices.Radios.RadioAccessStatus])) }
    $r = $script:radioCache[$kind]
    if ($Refresh -or -not $r) {
      $radios = Await ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]])
      $r = $radios | Where-Object { [string]$_.Kind -eq $kind } | Select-Object -First 1
      $script:radioCache[$kind] = $r
    }
    if (-not $r) { return @{ state = 'unsupported'; radio = $null; access = $script:radioAccess } }
    return @{ state = (ConvertTo-LiRadioState $r.State); radio = $r; access = $script:radioAccess }
  } catch {
    $f = Get-LiFault $_.Exception
    $script:radioCache[$kind] = $null
    [Console]::Error.WriteLine("radio ($kind) query failed: " + $f.message + ' [' + $f.detail + ']')
    return @{ state = 'error'; radio = $null; access = $script:radioAccess; error = $f.message; code = $f.code; detail = $f.detail }
  }
}
# Changes the radio and returns only once Windows really reports the requested state (or throws a typed error saying why not).
function Set-LiRadio([string]$kind, [bool]$on) {
  $info = Get-LiRadio $kind -Refresh -NewAccess
  if ($info.state -eq 'error') { Throw-LiError $info.code ("Windows would not report the $kind radio: " + $info.error) }
  if ($info.state -eq 'unsupported') { Throw-LiError 'no_radio' "Windows lists no $kind radio on this PC." }
  if ($info.access -ne 'Allowed') { Throw-LiError 'radio_denied' ("Windows refused radio control to this app ($($info.access)). Allow it in Settings > Privacy & security > Radios.") }
  $want = if ($on) { 'on' } else { 'off' }
  if ($info.state -ne $want) {
    $target = if ($on) { [Windows.Devices.Radios.RadioState]::On } else { [Windows.Devices.Radios.RadioState]::Off }
    $res = [string](Await ($info.radio.SetStateAsync($target)) ([Windows.Devices.Radios.RadioAccessStatus]))
    if ($res -ne 'Allowed') { Throw-LiError 'radio_denied' ("Windows did not allow the change ($res). Check Settings > Privacy & security > Radios.") }
  }
  $end = [DateTime]::UtcNow.AddMilliseconds(5000); $now = ''
  while ([DateTime]::UtcNow -lt $end) {                                   # bounded wait that only runs after a user action
    $now = (Get-LiRadio $kind -Refresh).state
    if ($now -eq $want) { return $now }
    Start-Sleep -Milliseconds 250
  }
  Throw-LiError 'unverified' ("Windows accepted the request but still reports the $kind radio as '$now'.")
}
