# Compiles every native C# source through the SAME path the helpers use at run time (Import-LiSource -> Add-Type) in Windows PowerShell 5.1.
# One fresh powershell.exe per helper, because Add-Type cannot define the same types twice in one session.
# Exit code: 0 = all compile, 1 = at least one failed. Run from anywhere: .\tools\windows\compile-native.ps1
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$common = Join-Path $root 'native\lib\common.ps1'
$sets = [ordered]@{ audio = @('Audio.cs'); net = @('Wlan.cs'); bt = @('Bluetooth.cs', 'WinRtEvents.cs'); power = @('Power.cs') }
Write-Host ('PowerShell ' + $PSVersionTable.PSVersion + ' / CLR ' + $PSVersionTable.CLRVersion)
$failed = 0
foreach ($name in $sets.Keys) {
  $files = ($sets[$name] | ForEach-Object { "'$_'" }) -join ','
  $cmd = ". '$common'; Import-LiSource $files; 'compiled'"
  $out = & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command $cmd 2>&1
  if ($LASTEXITCODE -eq 0 -and ($out -join "`n") -match 'compiled') { Write-Host ("OK    {0,-6} {1}" -f $name, ($sets[$name] -join ' + ')) }
  else { $failed++; Write-Host ("FAIL  {0,-6} {1}" -f $name, ($sets[$name] -join ' + ')); $out | ForEach-Object { Write-Host ('      ' + $_) } }
}
if ($failed) { Write-Host "$failed helper source set(s) failed to compile."; exit 1 } else { Write-Host 'All native C# compiled.'; exit 0 }
