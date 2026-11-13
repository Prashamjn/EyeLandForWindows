# Streams "now playing" info (any app that talks to Windows' media controls: Spotify, browsers, VLC, Apple Music...)
#
# Design rule (Phase 3 fix): the basic fields (title, artist, app, playing) must ALWAYS get through. Every WinRT wait has a time limit, the
# track info is sent BEFORE any artwork work, artwork is optional and fetched afterwards, and one failing iteration never ends the loop.
# (The first Phase 3 version fetched artwork inside the main loop with an unbounded wait; a player that never answered froze the helper.)
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
# Wait for a WinRT async operation for at most $ms milliseconds; $null when it did not finish in time.
function Await($op, $type, $ms = 8000) {
  $t = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op))
  if (-not $t.Wait($ms)) { return $null }
  $t.Result
}
function Log($m) { [Console]::Error.WriteLine('media: ' + $m) }
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]
$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]) 15000
if (-not $mgr) { Log 'Windows media session manager did not respond'; exit 1 }          # the app restarts this helper after 3 s

# Artwork support is optional: if any of this cannot load, titles and controls still work.
$artOk = $true
try {
  $null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
  Add-Type -AssemblyName System.Drawing -ErrorAction Stop
} catch { $artOk = $false; Log ('artwork disabled: ' + $_.Exception.Message) }

# Album artwork as a small JPEG (96x96, centre-cropped) in base64, or '' when unavailable. Never throws, never waits more than ~3 s.
function Get-Art($p) {
  $ras = $null; $img = $null; $bmp = $null; $g = $null
  try {
    if ($null -eq $p.Thumbnail) { return '' }
    $ras = Await ($p.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType]) 2500
    if ($null -eq $ras -or $ras.Size -lt 100 -or $ras.Size -gt 4MB) { return '' }
    $src = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($ras)
    $ms = New-Object System.IO.MemoryStream
    $src.CopyTo($ms)
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
    if ($b64.Length -gt 90000) { return '' }
    return $b64
  } catch { return '' }
  finally { if ($g) { $g.Dispose() }; if ($bmp) { $bmp.Dispose() }; if ($img) { $img.Dispose() }; if ($ras) { $ras.Dispose() } }
}
function Emit($o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress -Depth 4)); [Console]::Out.Flush() }

$lastCmp = ''; $trackKey = ''; $art = ''; $artSent = $true; $artTries = 0
while ($true) {
  try {
    # title, artist, album, app, playing; can{prev,next,play} = what the player supports; dur/pos/updated = timeline when the player reports
    # one (pos is the position at `updated`, epoch ms; the renderer extrapolates while playing); art once per track, in a later message
    $obj = @{ title = ''; artist = ''; album = ''; app = ''; playing = $false }
    $p = $null
    $s = $mgr.GetCurrentSession()
    if ($s) {
      $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]) 4000
      if ($p) { $obj.title = [string]$p.Title; $obj.artist = [string]$p.Artist; $obj.album = [string]$p.AlbumTitle }
      $obj.app = ([string]$s.SourceAppUserModelId) -replace '\.exe$', ''
      $info = $s.GetPlaybackInfo()
      $obj.playing = ([string]$info.PlaybackStatus -eq 'Playing')
      try {
        $c = $info.Controls
        $obj.can = @{ prev = [bool]$c.IsPreviousEnabled; next = [bool]$c.IsNextEnabled; play = ([bool]$c.IsPlayPauseToggleEnabled -or [bool]$c.IsPlayEnabled -or [bool]$c.IsPauseEnabled) }
      } catch { }
      try {
        $tl = $s.GetTimelineProperties()
        if ($tl) {
          $dur = ($tl.EndTime - $tl.StartTime).TotalSeconds
          if ($dur -gt 0) { $obj.dur = [Math]::Round($dur, 2); $obj.pos = [Math]::Round(($tl.Position - $tl.StartTime).TotalSeconds, 2); $obj.updated = [int64]$tl.LastUpdatedTime.ToUnixTimeMilliseconds() }
        }
      } catch { }
      $key = $obj.app + '|' + $obj.artist + '|' + $obj.title
      if ($key -ne $trackKey) { $trackKey = $key; $art = ''; $artSent = -not $artOk; $artTries = 0 }
    } else { $trackKey = ''; $art = ''; $artSent = $true }

    # 1) the essentials go out first
    $cmp = $obj | ConvertTo-Json -Compress -Depth 4
    if ($cmp -ne $lastCmp) { $lastCmp = $cmp; Emit $obj }

    # 2) artwork afterwards (up to 4 tries per track: players often publish the thumbnail a moment after the title)
    if ($p -and -not $artSent -and $artTries -lt 4 -and $obj.title) {
      $artTries++
      $art = Get-Art $p
      if ($art) { $artSent = $true; $o2 = $obj.Clone(); $o2.art = $art; Emit $o2 }
    }
  } catch { Log ('loop error: ' + $_.Exception.Message) }
  Start-Sleep -Milliseconds 1000
}
