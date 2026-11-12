# Streams "now playing" info (any app that talks to Windows' media controls: Spotify, browsers, VLC, Apple Music...)
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($op, $type) {
  $t = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op))
  $t.Wait(-1) | Out-Null; $t.Result
}
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]
$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])

$null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
Add-Type -AssemblyName System.Drawing

# Album artwork as a small JPEG (96x96, centre-cropped) in base64, or '' when the player offers none. Never throws.
function Get-Art($p) {
  try {
    if ($null -eq $p.Thumbnail) { return '' }
    $ras = Await ($p.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    if ($null -eq $ras) { return '' }
    $src = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($ras)
    $ms = New-Object System.IO.MemoryStream
    $src.CopyTo($ms); $ras.Dispose()
    if ($ms.Length -lt 100) { return '' }
    $ms.Position = 0
    $img = [System.Drawing.Image]::FromStream($ms)
    $bmp = New-Object System.Drawing.Bitmap 96, 96
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $side = [Math]::Min($img.Width, $img.Height)
    $sx = [int](($img.Width - $side) / 2); $sy = [int](($img.Height - $side) / 2)
    $dest = New-Object System.Drawing.Rectangle 0, 0, 96, 96
    $g.DrawImage($img, $dest, $sx, $sy, [int]$side, [int]$side, [System.Drawing.GraphicsUnit]::Pixel)
    $out = New-Object System.IO.MemoryStream
    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Jpeg)
    $b64 = [Convert]::ToBase64String($out.ToArray())
    $g.Dispose(); $bmp.Dispose(); $img.Dispose(); $out.Dispose(); $ms.Dispose()
    if ($b64.Length -gt 90000) { return '' }
    return $b64
  } catch { return '' }
}

$lastCmp = ''; $trackKey = ''; $art = ''; $artSent = $true; $artTries = 0
while ($true) {
  # fields: title, artist, album, app, playing; can{prev,next,play} = what the player supports; dur/pos/updated = timeline when the
  # player reports one (pos is the position at `updated`, epoch ms; the renderer extrapolates while playing); art once per track
  $obj = @{ title = ''; artist = ''; album = ''; app = ''; playing = $false }
  $s = $mgr.GetCurrentSession()
  if ($s) {
    $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
    $obj.title = [string]$p.Title; $obj.artist = [string]$p.Artist; $obj.album = [string]$p.AlbumTitle
    $obj.app = ([string]$s.SourceAppUserModelId) -replace '\.exe$', ''
    $info = $s.GetPlaybackInfo()
    $obj.playing = ([string]$info.PlaybackStatus -eq 'Playing')
    $c = $info.Controls
    $obj.can = @{ prev = [bool]$c.IsPreviousEnabled; next = [bool]$c.IsNextEnabled; play = ([bool]$c.IsPlayPauseToggleEnabled -or [bool]$c.IsPlayEnabled -or [bool]$c.IsPauseEnabled) }
    $tl = $s.GetTimelineProperties()
    if ($tl) {
      $dur = ($tl.EndTime - $tl.StartTime).TotalSeconds
      if ($dur -gt 0) { $obj.dur = [Math]::Round($dur, 2); $obj.pos = [Math]::Round(($tl.Position - $tl.StartTime).TotalSeconds, 2); $obj.updated = [int64]$tl.LastUpdatedTime.ToUnixTimeMilliseconds() }
    }
    $key = $obj.app + '|' + $obj.artist + '|' + $obj.title
    if ($key -ne $trackKey) { $trackKey = $key; $art = ''; $artSent = $false; $artTries = 0 }
    if (-not $artSent -and $art -eq '' -and $artTries -lt 4 -and $obj.title) { $art = Get-Art $p; $artTries++ }
  } else { $trackKey = ''; $art = ''; $artSent = $true }
  $cmp = $obj | ConvertTo-Json -Compress -Depth 4
  $fresh = (-not $artSent) -and $art -ne ''
  if ($cmp -ne $lastCmp -or $fresh) {
    $lastCmp = $cmp
    if ($fresh) { $obj.art = $art; $artSent = $true }
    [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 4)); [Console]::Out.Flush()
  }
  Start-Sleep -Milliseconds 1000
}
