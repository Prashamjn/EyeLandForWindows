# Audio helper: volume, mute, output devices (list + switch), microphone mute state. Event-driven (see cs\Audio.cs).
. (Join-Path $PSScriptRoot 'lib\common.ps1')
Import-LiSource 'Audio.cs'
try { [LiAudio]::Init() } catch { [Console]::Error.WriteLine('audio init failed: ' + $_.Exception.Message); Send-LiEvent 'audio' @{ available = $false; error = $_.Exception.Message } }

Start-LiLoop -OnCommand {
  param($c)
  switch ($c.cmd) {
    'get'         { return (ConvertFrom-Json ([LiAudio]::StateJson())) }
    'setVolume'   { [LiAudio]::SetVolume([int]$c.value); return $true }
    'setMute'     { [LiAudio]::SetMute([bool]$c.muted); return $true }
    'toggleMute'  { $s = ConvertFrom-Json ([LiAudio]::StateJson()); [LiAudio]::SetMute(-not $s.audio.muted); return $true }
    'setMicMute'  { [LiAudio]::SetMicMute([bool]$c.muted); return $true }
    'setOutput'   { [LiAudio]::SetDefaultOutput([string]$c.id); return $true }
    default       { Throw-LiError 'unknown' ('Unknown command ' + $c.cmd) }
  }
}
