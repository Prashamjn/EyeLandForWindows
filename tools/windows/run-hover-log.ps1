# Starts Liquid Island with the hover trace switched on and prints what Windows says about animations and displays.
# Everything the island decides (cursor in/out, expand, collapse, why a collapse was blocked, holds, native dialogs, display
# and DPI of the cursor) is written to diagnostics\hover-<time>.log. Follow docs\PHASE_3_WINDOWS_TEST_GUIDE.md, then send me that file.
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Add-Type -AssemblyName System.Windows.Forms
Write-Host ('Windows "Animation effects" (UIEffectsEnabled): ' + [System.Windows.Forms.SystemInformation]::UIEffectsEnabled)
Write-Host '   False means Chromium reports reduced motion; Liquid Island then needs Settings > Motion > "Always animate" to animate.'
Write-Host 'Displays:'
[System.Windows.Forms.Screen]::AllScreens | ForEach-Object { '  {0}  bounds={1}  primary={2}' -f $_.DeviceName, $_.Bounds, $_.Primary }
$env:LI_HOVER_LOG = '1'
Push-Location $root
try { npx electron . } finally { Pop-Location; Remove-Item Env:LI_HOVER_LOG -ErrorAction SilentlyContinue }
