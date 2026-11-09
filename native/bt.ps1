# Bluetooth helper. WinRT (Windows.Devices.Bluetooth / Enumeration / Radios) for state, events, discovery and pairing;
# BluetoothSetServiceState (cs\Bluetooth.cs) to connect / disconnect paired devices. Never reports "connected" unless Windows says so.
. (Join-Path $PSScriptRoot 'lib\common.ps1')
Import-LiSource 'Bluetooth.cs'
. (Join-Path $PSScriptRoot 'lib\winrt.ps1')
[void][Windows.Devices.Bluetooth.BluetoothDevice, Windows.Devices.Bluetooth, ContentType = WindowsRuntime]
[void][Windows.Devices.Bluetooth.BluetoothLEDevice, Windows.Devices.Bluetooth, ContentType = WindowsRuntime]
[void][Windows.Devices.Enumeration.DeviceInformation, Windows.Devices.Enumeration, ContentType = WindowsRuntime]
[void][Windows.Devices.Enumeration.DeviceInformationCollection, Windows.Devices.Enumeration, ContentType = WindowsRuntime]
[void][Windows.Devices.Enumeration.DevicePairingResult, Windows.Devices.Enumeration, ContentType = WindowsRuntime]

$script:devs = @{}        # id -> BluetoothDevice (kept alive so ConnectionStatusChanged keeps firing)
$script:le = @{}          # id -> $true for low-energy devices
$script:sig = ''
$script:watcher = $null; $script:found = @{}; $script:scanTimer = $null
$KINDS = @('other', 'computer', 'phone', 'network', 'audio', 'peripheral', 'imaging', 'wearable', 'toy', 'health')

function Get-PairedDevices {
  $list = @()
  foreach ($le in @($false, $true)) {
    try {
      $sel = if ($le) { [Windows.Devices.Bluetooth.BluetoothLEDevice]::GetDeviceSelectorFromPairingState($true) } else { [Windows.Devices.Bluetooth.BluetoothDevice]::GetDeviceSelectorFromPairingState($true) }
      $infos = Await ([Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync($sel)) ([Windows.Devices.Enumeration.DeviceInformationCollection])
      foreach ($i in $infos) {
        if (-not $script:devs.ContainsKey($i.Id)) {
          try {
            $bd = if ($le) { Await ([Windows.Devices.Bluetooth.BluetoothLEDevice]::FromIdAsync($i.Id)) ([Windows.Devices.Bluetooth.BluetoothLEDevice]) } else { Await ([Windows.Devices.Bluetooth.BluetoothDevice]::FromIdAsync($i.Id)) ([Windows.Devices.Bluetooth.BluetoothDevice]) }
            if (-not $bd) { continue }
            $script:devs[$i.Id] = $bd; $script:le[$i.Id] = $le
            Register-ObjectEvent -InputObject $bd -EventName ConnectionStatusChanged -SourceIdentifier ('li.bt:' + $i.Id) | Out-Null
          } catch { continue }
        }
        $bd = $script:devs[$i.Id]
        $kind = if ($le) { 'peripheral' } else { try { $KINDS[[int]$bd.ClassOfDevice.MajorClass] } catch { 'other' } }
        $list += @{ id = $i.Id; name = $i.Name; connected = ($bd.ConnectionStatus -eq 'Connected'); paired = $true; kind = $kind; le = $le }
      }
    } catch { }
  }
  return $list
}
function Get-BtState {
  $r = Get-LiRadio 'Bluetooth'
  $devs = if ($r.state -eq 'on') { @(Get-PairedDevices) } else { @() }
  return @{ radio = $r.state; devices = $devs; radioError = $r.error; radioAccess = $r.access }
}
$emitState = {
  $s = Get-BtState
  $sig = ConvertTo-LiJson $s
  if ($sig -ne $script:sig) { $script:sig = $sig; Send-LiEvent 'bt' $s }
}
function Stop-Scan {
  if ($script:watcher) { try { if ($script:watcher.Status -in 'Started', 'EnumerationCompleted') { $script:watcher.Stop() } } catch { } }
  Get-EventSubscriber | Where-Object { $_.SourceIdentifier -like 'li.scan.*' } | Unregister-Event -ErrorAction SilentlyContinue
  if ($script:scanTimer) { $script:scanTimer.Stop(); $script:scanTimer.Dispose(); $script:scanTimer = $null }
  $script:watcher = $null
}

# Bluetooth radio switch + a slow safety-net re-read (every 30 s) in case an event is missed by a driver
$script:btRadio = (Get-LiRadio 'Bluetooth').radio
if ($script:btRadio) { try { Register-ObjectEvent -InputObject $script:btRadio -EventName StateChanged -SourceIdentifier 'li.btradio' | Out-Null } catch { } }
$recon = New-Object System.Timers.Timer 30000
Register-ObjectEvent -InputObject $recon -EventName Elapsed -SourceIdentifier 'li.recon' | Out-Null
$recon.Start()
& $emitState

function Get-Bd([string]$id) { if (-not $script:devs.ContainsKey($id)) { Get-PairedDevices | Out-Null }; $bd = $script:devs[$id]; if (-not $bd) { Throw-LiError 'not_found' 'That device is not paired with this PC.' }; return $bd }
function Wait-Status($bd, [string]$want, [int]$ms) {
  $end = [DateTime]::UtcNow.AddMilliseconds($ms)
  while ([DateTime]::UtcNow -lt $end) { if ($bd.ConnectionStatus -eq $want) { return $true }; Start-Sleep -Milliseconds 400 }   # bounded, only during a user-started connect
  return ($bd.ConnectionStatus -eq $want)
}

Start-LiLoop -OnCommand {
  param($c)
  switch ($c.cmd) {
    'get'      { return (Get-BtState) }
    'setRadio' { Set-LiRadio 'Bluetooth' ([bool]$c.on) | Out-Null; & $emitState; return $true }
    'scan' {
      $r = Get-LiRadio 'Bluetooth'
      if ($r.state -ne 'on') { Throw-LiError 'off' 'Turn Bluetooth on first.' }
      Stop-Scan; $script:found = @{}
      $script:watcher = [Windows.Devices.Enumeration.DeviceInformation]::CreateWatcher([Windows.Devices.Bluetooth.BluetoothDevice]::GetDeviceSelectorFromPairingState($false))
      foreach ($n in 'Added', 'Updated') { Register-ObjectEvent -InputObject $script:watcher -EventName $n -SourceIdentifier ('li.scan.' + $n) | Out-Null }
      $script:watcher.Start()
      $secs = [Math]::Max(4, [Math]::Min(30, [int]$c.seconds))
      $script:scanTimer = New-Object System.Timers.Timer ($secs * 1000); $script:scanTimer.AutoReset = $false
      Register-ObjectEvent -InputObject $script:scanTimer -EventName Elapsed -SourceIdentifier 'li.scan.done' | Out-Null
      $script:scanTimer.Start(); return $true
    }
    'stopScan' { Stop-Scan; Send-LiEvent 'bt-scan' @{ done = $true; devices = @($script:found.Values) }; return $true }
    'pair' {
      $di = Await ([Windows.Devices.Enumeration.DeviceInformation]::CreateFromIdAsync([string]$c.id)) ([Windows.Devices.Enumeration.DeviceInformation])
      if ($di.Pairing.IsPaired) { return $true }
      $res = Await ($di.Pairing.PairAsync()) ([Windows.Devices.Enumeration.DevicePairingResult]) 60000
      if ($res.Status -ne 'Paired' -and $res.Status -ne 'AlreadyPaired') { Throw-LiError 'pair_failed' ('Pairing did not complete (' + $res.Status + '). Put the device in pairing mode and try again.') }
      & $emitState; return $true
    }
    'connect' {
      $bd = Get-Bd ([string]$c.id)
      if ($script:le[[string]$c.id]) { Throw-LiError 'unsupported' 'Low-energy devices reconnect by themselves when you use them. Windows has no way to force it.' }
      if ($bd.ConnectionStatus -eq 'Connected') { return $true }
      $n = [LiBt]::SetServices([uint64]$bd.BluetoothAddress, $true)
      if ($n -eq 0) { Throw-LiError 'unsupported' 'This device has no profile Windows lets apps switch on.' }
      if (-not (Wait-Status $bd 'Connected' 9000)) { Throw-LiError 'not_connected' 'Windows did not confirm a connection. Make sure the device is on, in range and not connected to another device.' }
      & $emitState; return $true
    }
    'disconnect' {
      $bd = Get-Bd ([string]$c.id)
      if ($script:le[[string]$c.id]) { Throw-LiError 'unsupported' 'Windows does not let apps disconnect low-energy devices.' }
      if ($bd.ConnectionStatus -ne 'Connected') { return $true }
      [void][LiBt]::SetServices([uint64]$bd.BluetoothAddress, $false)
      $ok = Wait-Status $bd 'Disconnected' 6000
      Start-Sleep -Milliseconds 800
      [void][LiBt]::SetServices([uint64]$bd.BluetoothAddress, $true)      # leave the profiles enabled so the device can be connected again later
      if (-not $ok) { Throw-LiError 'not_disconnected' 'Windows kept the device connected.' }
      & $emitState; return $true
    }
    default { Throw-LiError 'unknown' ('Unknown command ' + $c.cmd) }
  }
} -OnEvent {
  param($e)
  $id = $e.SourceIdentifier
  if ($id -like 'li.bt:*' -or $id -eq 'li.btradio' -or $id -eq 'li.recon') { & $emitState }
  elseif ($id -eq 'li.scan.Added' -or $id -eq 'li.scan.Updated') {
    $a = $e.SourceArgs[1]
    if ($id -eq 'li.scan.Added' -and $a.Name) { $script:found[$a.Id] = @{ id = $a.Id; name = $a.Name; paired = $false }; Send-LiEvent 'bt-scan' @{ done = $false; devices = @($script:found.Values) } }
    elseif ($id -eq 'li.scan.Updated' -and $script:found.ContainsKey($a.Id)) { }
  }
  elseif ($id -eq 'li.scan.done') { Stop-Scan; Send-LiEvent 'bt-scan' @{ done = $true; devices = @($script:found.Values) } }
}
