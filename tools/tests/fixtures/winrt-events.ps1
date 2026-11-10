# Runs the production LiWinRt + LiHub + Start-LiLoop path against fake WinRT-shaped objects.
$native = [System.IO.Path]::Combine($PSScriptRoot, '..', '..', '..', 'native')
. ([System.IO.Path]::Combine($native, 'lib', 'common.ps1'))
Add-Type -Path @([System.IO.Path]::Combine($native, 'cs', 'LiIO.cs'), [System.IO.Path]::Combine($native, 'cs', 'WinRtEvents.cs'), [System.IO.Path]::Combine($PSScriptRoot, 'WinRtFake.cs'))
$script:radio = New-Object FakeRadio; $script:watcher = New-Object FakeWatcher
Register-ObjectEvent -InputObject ([LiHub]::Instance) -EventName Signal -SourceIdentifier 'li.hub' | Out-Null
Start-LiLoop -OnCommand {
  param($c)
  switch ($c.cmd) {
    'subscribe' { return @{ radio = [LiWinRt]::Subscribe('btradio', $script:radio, 'StateChanged'); watcher = [LiWinRt]::Subscribe('scan:le:Added', $script:watcher, 'Added'); count = [LiWinRt]::Count } }
    'fire'      { $script:radio.Fire('Off'); $script:watcher.Add('dev-9', 'Beats'); return $true }
    'unsub'     { [LiWinRt]::UnsubscribePrefix('scan:'); $script:watcher.Add('ignored', 'ignored'); return @{ count = [LiWinRt]::Count } }
    'bad'       { return @{ missing = [LiWinRt]::Subscribe('x', $script:radio, 'NoSuchEvent'); nulltarget = [LiWinRt]::Subscribe('y', $null, 'StateChanged') } }
    default     { Throw-LiError 'unknown' $c.cmd }
  }
} -OnEvent {
  param($e)
  if ($e.SourceIdentifier -eq 'li.hub') { $a = $e.SourceEventArgs; Send-LiEvent 'signal' @{ tag = $a.Tag; id = $a.Id; name = $a.Name; extra = $a.Extra } }
}
