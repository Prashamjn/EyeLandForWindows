# Bluetooth helper. WinRT (Windows.Devices.Bluetooth / Enumeration / Radios) for state, discovery and pairing;
# BluetoothSetServiceState (cs\Bluetooth.cs) to connect / disconnect paired classic devices. Never reports "connected" unless Windows says so.
#
# EVENTS: Windows PowerShell cannot subscribe to WinRT events (Register-ObjectEvent fails with "cannot subscribe to Windows RT events"), so every
# WinRT event is subscribed by compiled C# (cs\WinRtEvents.cs: LiWinRt) and re-raised on LiHub, an ordinary .NET event PowerShell can wait on.
# If a subscription fails the exact reason is recorded (state.events / state.eventErrors) and ONLY THEN a light 5 s status read runs.
. (Join-Path $PSScriptRoot 'lib\common.ps1')
Import-LiSource 'Bluetooth.cs', 'WinRtEvents.cs'
. (Join-Path $PSScriptRoot 'lib\winrt.ps1')
[void][Windows.Devices.Bluetooth.BluetoothDevice, Windows.Devices.Bluetooth, ContentType = WindowsRuntime]
[void][Windows.Devices.Bluetooth.BluetoothLEDevice, Windows.Devices.Bluetooth, ContentType = WindowsRuntime]
[void][Windows.Devices.Enumeration.DeviceInformation, Windows.Devices.Enumeration, ContentType = WindowsRuntime]
[void][Windows.Devices.Enumeration.DeviceInformationCollection, Windows.Devices.Enumeration, ContentType = WindowsRuntime]
[void][Windows.Devices.Enumeration.DevicePairingResult, Windows.Devices.Enumeration, ContentType = WindowsRuntime]

$script:devs = @{}        # id -> BluetoothDevice / BluetoothLEDevice (kept alive so ConnectionStatusChanged keeps firing)
$script:le = @{}          # id -> $true for low-energy devices
$script:names = @{}
$script:sig = ''; $script:enumerated = $false; $script:pairedError = $null
$script:eventMode = 'events'; $script:evErrors = @()
$script:scanWatchers = @(); $script:found = @{}; $script:scanTimer = $null; $script:scanPoll = $null; $script:pairedWatchers = @(); $script:pwReady = @{}
$KINDS = @('other', 'computer', 'phone', 'network', 'audio', 'peripheral', 'imaging', 'wearable', 'toy', 'health')

function Write-Log([string]$m) { [Console]::Error.WriteLine($m) }
function Add-EvError([string]$what, $err) { if ($err) { $script:evErrors += ($what + ': ' + $err); $script:eventMode = 'polling'; Write-Log ('bluetooth event subscription failed (' + $what + '): ' + $err) } }
function Get-Selector([bool]$le, [bool]$paired) { if ($le) { [Windows.Devices.Bluetooth.BluetoothLEDevice]::GetDeviceSelectorFromPairingState($paired) } else { [Windows.Devices.Bluetooth.BluetoothDevice]::GetDeviceSelectorFromPairingState($paired) } }

# (Re-)enumerates paired devices and subscribes each new one. A device that fails to open is logged, never silently dropped.
function Update-Paired {
  $seen = @{}; $okKind = @{ $false = $false; $true = $false }; $script:pairedError = $null
  foreach ($le in @($false, $true)) {
    try {
      $infos = Await ([Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync((Get-Selector $le $true))) ([Windows.Devices.Enumeration.DeviceInformationCollection])
      $okKind[$le] = $true
      foreach ($i in $infos) {
        $seen[$i.Id] = $true
        if ($script:devs.ContainsKey($i.Id)) { continue }
        try {
          $bd = if ($le) { Await ([Windows.Devices.Bluetooth.BluetoothLEDevice]::FromIdAsync($i.Id)) ([Windows.Devices.Bluetooth.BluetoothLEDevice]) } else { Await ([Windows.Devices.Bluetooth.BluetoothDevice]::FromIdAsync($i.Id)) ([Windows.Devices.Bluetooth.BluetoothDevice]) }
          if (-not $bd) { Write-Log ('bluetooth: Windows returned no object for paired device ' + $i.Name); continue }
          $script:devs[$i.Id] = $bd; $script:le[$i.Id] = $le; $script:names[$i.Id] = $i.Name
          Add-EvError ('device "' + $i.Name + '"') ([LiWinRt]::Subscribe('dev:' + $i.Id, $bd, 'ConnectionStatusChanged'))   # the device is kept even if the subscription fails
        } catch { $f = Get-LiFault $_.Exception; Write-Log ('bluetooth: could not open paired device ' + $i.Name + ': ' + $f.message) }
      }
    } catch { $f = Get-LiFault $_.Exception; $script:pairedError = $f.message; Write-Log ('bluetooth: listing paired ' + $(if ($le) { 'LE' } else { 'classic' }) + ' devices failed: ' + $f.message) }
  }
  foreach ($id in @($script:devs.Keys)) {                    # forget devices Windows no longer lists (only for a kind whose listing worked)
    if (-not $seen.ContainsKey($id) -and $okKind[[bool]$script:le[$id]]) { [LiWinRt]::Unsubscribe('dev:' + $id); $script:devs.Remove($id); $script:le.Remove($id); $script:names.Remove($id) }
  }
  $script:enumerated = $true
  Start-FastIfNeeded
}

function Get-BtState([switch]$Enumerate) {
  $r = Get-LiRadio 'Bluetooth'
  $devs = @()
  if ($r.state -eq 'on') {
    if ($Enumerate -or -not $script:enumerated) { Update-Paired }
    foreach ($id in @($script:devs.Keys)) {
      $bd = $script:devs[$id]; $le = [bool]$script:le[$id]
      try {
        $kind = if ($le) { 'peripheral' } else { try { $KINDS[[int]$bd.ClassOfDevice.MajorClass] } catch { 'other' } }
        $devs += @{ id = $id; name = $script:names[$id]; connected = ([string]$bd.ConnectionStatus -eq 'Connected'); paired = $true; kind = $kind; le = $le }
      } catch { Write-Log ('bluetooth: could not read ' + $script:names[$id] + ': ' + (Get-LiFault $_.Exception).message) }
    }
    $devs = @($devs | Sort-Object { $_.name }, { $_.id })
  }
  return @{ radio = $r.state; devices = $devs; radioError = $r.error; radioAccess = $r.access; pairedError = $script:pairedError; events = $script:eventMode; eventErrors = @($script:evErrors) }
}
$emitState = {
  param([switch]$Enumerate)
  $s = Get-BtState -Enumerate:$Enumerate
  $sig = ConvertTo-LiJson $s
  if ($sig -ne $script:sig) { $script:sig = $sig; Send-LiEvent 'bt' $s }
}

# ---- the only polling in this helper, and only when an event subscription really failed ----
$script:fast = $null
function Start-FastIfNeeded {
  if ($script:eventMode -ne 'polling' -or $script:fast) { return }
  $script:fast = New-Object System.Timers.Timer 5000
  Register-ObjectEvent -InputObject $script:fast -EventName Elapsed -SourceIdentifier 'li.fast' | Out-Null
  $script:fast.Start(); Write-Log 'bluetooth: event subscription failed, reading status every 5 s as a fallback'
}

function Stop-Scan {
  foreach ($w in $script:scanWatchers) { try { if ([string]$w.Status -in 'Started', 'EnumerationCompleted') { $w.Stop() } } catch { } }
  $script:scanWatchers = @()
  [LiWinRt]::UnsubscribePrefix('scan:')
  Get-EventSubscriber | Where-Object { $_.SourceIdentifier -like 'li.scan.*' } | Unregister-Event -ErrorAction SilentlyContinue
  foreach ($t in @($script:scanTimer, $script:scanPoll)) { if ($t) { $t.Stop(); $t.Dispose() } }
  $script:scanTimer = $null; $script:scanPoll = $null
}
function Add-Found([string]$id, [string]$name, [bool]$le) {
  if (-not $id -or -not $name -or $script:found.ContainsKey($id) -or $script:devs.ContainsKey($id)) { return }     # unnamed advertisers and already-paired devices are not offered
  $script:found[$id] = @{ id = $id; name = $name; paired = $false; le = $le }
  Send-LiEvent 'bt-scan' @{ done = $false; devices = @($script:found.Values) }
}

# paired-device watcher: new / removed pairings (made in Windows Settings, say) arrive as events instead of being found by periodic enumeration
function Start-PairedWatch {
  foreach ($le in @($false, $true)) {
    $k = if ($le) { 'le' } else { 'classic' }
    try {
      $w = [Windows.Devices.Enumeration.DeviceInformation]::CreateWatcher((Get-Selector $le $true))
      foreach ($n in 'Added', 'Removed', 'EnumerationCompleted') { Add-EvError ("paired watcher $k $n") ([LiWinRt]::Subscribe("pw:${k}:$n", $w, $n)) }
      $w.Start(); $script:pairedWatchers += $w
    } catch { Write-Log ("bluetooth: paired watcher ($k) not started: " + (Get-LiFault $_.Exception).message); Add-EvError "paired watcher $k" (Get-LiFault $_.Exception).message }
  }
}

# ---- start-up ----
Register-ObjectEvent -InputObject ([LiHub]::Instance) -EventName Signal -SourceIdentifier 'li.hub' | Out-Null
$rr = Get-LiRadio 'Bluetooth'
if ($rr.radio) { Add-EvError 'bluetooth radio StateChanged' ([LiWinRt]::Subscribe('btradio', $rr.radio, 'StateChanged')) }
Start-PairedWatch
$recon = New-Object System.Timers.Timer 120000                    # safety net only: a full re-listing every 2 minutes (events do the real work)
Register-ObjectEvent -InputObject $recon -EventName Elapsed -SourceIdentifier 'li.recon' | Out-Null
$recon.Start()
$enumDebounce = New-Object System.Timers.Timer 800; $enumDebounce.AutoReset = $false
Register-ObjectEvent -InputObject $enumDebounce -EventName Elapsed -SourceIdentifier 'li.enum' | Out-Null
& $emitState -Enumerate
Send-LiEvent 'bt-events' @{ mode = $script:eventMode; errors = @($script:evErrors) }

function Get-Bd([string]$id) { if (-not $script:devs.ContainsKey($id)) { Update-Paired }; $bd = $script:devs[$id]; if (-not $bd) { Throw-LiError 'not_found' 'That device is not paired with this PC.' }; return $bd }
function Wait-Status($bd, [string]$want, [int]$ms) {
  $end = [DateTime]::UtcNow.AddMilliseconds($ms)
  while ([DateTime]::UtcNow -lt $end) { if ([string]$bd.ConnectionStatus -eq $want) { return $true }; Start-Sleep -Milliseconds 300 }   # bounded, only during a user-started connect
  return ([string]$bd.ConnectionStatus -eq $want)
}

Start-LiLoop -OnCommand {
  param($c)
  switch ($c.cmd) {
    'get'      { return (Get-BtState -Enumerate) }
    'setRadio' { Set-LiRadio 'Bluetooth' ([bool]$c.on) | Out-Null; & $emitState -Enumerate; return $true }          # Set-LiRadio returns only once Windows reports the new state
    'scan' {
      $r = Get-LiRadio 'Bluetooth'
      if ($r.state -ne 'on') { Throw-LiError 'off' 'Turn Bluetooth on first.' }
      Stop-Scan; $script:found = @{}; $errs = @(); $subscribed = 0
      foreach ($le in @($false, $true)) {                              # classic AND low-energy devices
        $k = if ($le) { 'le' } else { 'classic' }
        try {
          $w = [Windows.Devices.Enumeration.DeviceInformation]::CreateWatcher((Get-Selector $le $false))
          $e = [LiWinRt]::Subscribe("scan:${k}:Added", $w, 'Added')
          if ($e) { $errs += "$k events: $e" } else { $subscribed++ }
          $w.Start(); $script:scanWatchers += $w
        } catch { $errs += ("$k discovery: " + (Get-LiFault $_.Exception).message) }
      }
      if ($script:scanWatchers.Count -eq 0) { Throw-LiError 'scan_failed' ('Windows would not start Bluetooth discovery: ' + ($errs -join '; ')) }
      if ($subscribed -lt $script:scanWatchers.Count) {                 # events unavailable: read the watcher results every 3 s, for the length of this scan only
        $script:scanPoll = New-Object System.Timers.Timer 3000
        Register-ObjectEvent -InputObject $script:scanPoll -EventName Elapsed -SourceIdentifier 'li.scan.poll' | Out-Null; $script:scanPoll.Start()
        Write-Log ('bluetooth: discovery events unavailable, polling during the scan: ' + ($errs -join '; '))
      }
      $secs = [Math]::Max(4, [Math]::Min(30, [int]$c.seconds))
      $script:scanTimer = New-Object System.Timers.Timer ($secs * 1000); $script:scanTimer.AutoReset = $false
      Register-ObjectEvent -InputObject $script:scanTimer -EventName Elapsed -SourceIdentifier 'li.scan.done' | Out-Null
      $script:scanTimer.Start(); return @{ started = $script:scanWatchers.Count; warnings = @($errs) }
    }
    'stopScan' { Stop-Scan; Send-LiEvent 'bt-scan' @{ done = $true; devices = @($script:found.Values) }; return $true }
    'pair' {
      $di = Await ([Windows.Devices.Enumeration.DeviceInformation]::CreateFromIdAsync([string]$c.id)) ([Windows.Devices.Enumeration.DeviceInformation])
      if (-not $di.Pairing.IsPaired) {
        $res = Await ($di.Pairing.PairAsync()) ([Windows.Devices.Enumeration.DevicePairingResult]) 60000
        if ([string]$res.Status -ne 'Paired' -and [string]$res.Status -ne 'AlreadyPaired') { Throw-LiError 'pair_failed' ('Pairing did not complete (' + $res.Status + '). Put the device in pairing mode and try again.') }
      }
      & $emitState -Enumerate; return $true
    }
    'connect' {
      $bd = Get-Bd ([string]$c.id); $addr = [uint64]$bd.BluetoothAddress
      if ($script:le[[string]$c.id]) { Throw-LiError 'unsupported' 'Low-energy devices reconnect by themselves when you use them. Windows has no way for an app to force it.' }
      if ([string]$bd.ConnectionStatus -eq 'Connected') { return $true }
      $n = [LiBt]::SetServices($addr, $true)
      if ($n -eq 0) { Throw-LiError 'unsupported' ('Windows would not enable any profile for this device (error codes ' + [LiBt]::LastCodes + '; 1060 means the device has no such profile).') }
      if (-not (Wait-Status $bd 'Connected' 3500)) {
        # Profiles that are already enabled make "enable" a no-op in Windows. Switch them off and on again to force a fresh connection attempt.
        [void][LiBt]::SetServices($addr, $false); Start-Sleep -Milliseconds 700; [void][LiBt]::SetServices($addr, $true)
        if (-not (Wait-Status $bd 'Connected' 9000)) { Throw-LiError 'not_connected' 'Windows did not confirm a connection. Make sure the device is on, in range and not connected to another device.' }
      }
      & $emitState; return $true
    }
    'disconnect' {
      $bd = Get-Bd ([string]$c.id); $addr = [uint64]$bd.BluetoothAddress
      if ($script:le[[string]$c.id]) { Throw-LiError 'unsupported' 'Windows does not let apps disconnect low-energy devices.' }
      if ([string]$bd.ConnectionStatus -ne 'Connected') { return $true }
      [void][LiBt]::SetServices($addr, $false)
      $ok = Wait-Status $bd 'Disconnected' 6000
      Start-Sleep -Milliseconds 800
      [void][LiBt]::SetServices($addr, $true)                          # leave the profiles enabled so the device can be connected again later
      if (-not $ok) { Throw-LiError 'not_disconnected' ('Windows kept the device connected (profile error codes ' + [LiBt]::LastCodes + ').') }
      & $emitState; return $true
    }
    default { Throw-LiError 'unknown' ('Unknown command ' + $c.cmd) }
  }
} -OnEvent {
  param($e)
  $id = $e.SourceIdentifier
  if ($id -eq 'li.hub') {
    $a = $e.SourceEventArgs; $tag = [string]$a.Tag
    if ($tag -eq 'btradio') { & $emitState -Enumerate }
    elseif ($tag -like 'dev:*') { & $emitState }
    elseif ($tag -like 'pw:*') {
      $kind = ($tag -split ':')[1]
      if ($tag -like '*:EnumerationCompleted') { $script:pwReady[$kind] = $true }
      elseif ($script:pwReady[$kind]) { $enumDebounce.Stop(); $enumDebounce.Start() }              # a pairing changed: re-list once, after a short settle
    }
    elseif ($tag -like 'scan:*') { Add-Found ([string]$a.Id) ([string]$a.Name) ($tag -like 'scan:le:*') }
  }
  elseif ($id -eq 'li.recon' -or $id -eq 'li.enum') { & $emitState -Enumerate }
  elseif ($id -eq 'li.fast') { & $emitState }
  elseif ($id -eq 'li.scan.poll') {
    foreach ($le in @($false, $true)) { try { foreach ($i in (Await ([Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync((Get-Selector $le $false))) ([Windows.Devices.Enumeration.DeviceInformationCollection]))) { Add-Found $i.Id $i.Name $le } } catch { } }
  }
  elseif ($id -eq 'li.scan.done') { Stop-Scan; Send-LiEvent 'bt-scan' @{ done = $true; devices = @($script:found.Values) } }
}
