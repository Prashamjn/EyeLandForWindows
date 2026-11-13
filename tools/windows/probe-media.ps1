# Runs native\media.ps1 exactly as the app does and prints every line it sends (with the time it arrived), plus anything it writes to
# stderr. Use it while a song or video plays to see whether Windows reports it. Usage: .\tools\windows\probe-media.ps1 [-Seconds 20]
param([int]$Seconds = 20)
$script = (Resolve-Path (Join-Path $PSScriptRoot '..\..\native\media.ps1')).Path
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = 'powershell.exe'
$psi.Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$script`""
$psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true; $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
$psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
$p = [System.Diagnostics.Process]::Start($psi)
$errTask = $p.StandardError.ReadToEndAsync()
$sw = [System.Diagnostics.Stopwatch]::StartNew(); $n = 0; $first = $null
Write-Host "Reading the media helper for $Seconds s. Start or pause something in Spotify / a browser now."
$task = $p.StandardOutput.ReadLineAsync()
while ($sw.Elapsed.TotalSeconds -lt $Seconds -and -not $p.HasExited) {
  if ($task.Wait(500)) {
    $line = $task.Result; if ($null -eq $line) { break }
    $n++; if ($null -eq $first) { $first = $sw.Elapsed.TotalSeconds }
    $shown = [regex]::Replace($line, '"art":"[^"]{20,}"', '"art":"<jpeg base64 omitted>"')
    Write-Host ('{0,6:N1}s  {1}' -f $sw.Elapsed.TotalSeconds, $shown)
    $task = $p.StandardOutput.ReadLineAsync()
  }
}
$exited = $p.HasExited
if (-not $exited) { $p.Kill() }
Start-Sleep -Milliseconds 300
Write-Host ''
if ($n -eq 0) { Write-Host 'RESULT: the helper sent NOTHING in this time.' -ForegroundColor Red } else { Write-Host ("RESULT: {0} message(s); first after {1:N1} s." -f $n, $first) -ForegroundColor Green }
if ($exited) { Write-Host ('The helper EXITED on its own (exit code ' + $p.ExitCode + ').') -ForegroundColor Yellow }
$e = $errTask.Result; if ($e) { Write-Host 'stderr:'; Write-Host $e }
