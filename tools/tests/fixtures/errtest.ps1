# Test fixture: runs the PRODUCTION Start-LiLoop (native/lib/common.ps1) with commands that fail in every way a real helper can.
$root = [System.IO.Path]::Combine($PSScriptRoot, '..', '..', '..', 'native')
. ([System.IO.Path]::Combine($root, 'lib', 'common.ps1'))
Add-Type -Path @([System.IO.Path]::Combine($root, 'cs', 'LiIO.cs'), [System.IO.Path]::Combine($PSScriptRoot, 'ErrFixture.cs'))
Start-LiLoop -OnCommand {
  param($c)
  switch ($c.cmd) {
    'typed'   { [ErrFixture]::ThrowTyped() }
    'com'     { [ErrFixture]::ThrowCom() }
    'plain'   { [ErrFixture]::ThrowPlain() }
    'deep'    { [ErrFixture]::ThrowDeep() }
    'pstyped' { Throw-LiError 'timeout' 'Windows did not respond in time.' }
    'task'    { [ErrFixture]::WaitOnFailedTask() }
    'ok'      { return [ErrFixture]::Ok() }
    'old'     { try { [ErrFixture]::ThrowTyped() } catch { $code = 'failed'; if ($_.Exception -is [LiError]) { $code = $_.Exception.Code }; return @{ code = $code; message = $_.Exception.Message } } }   # the Phase 2 logic, for comparison
  }
}
