param([string]$Mode = 'watch', [string]$Target = '', [int]$Value = 0)
$ErrorActionPreference = 'SilentlyContinue'

function Out-Line($s) { [Console]::Out.WriteLine($s); [Console]::Out.Flush() }
function Out-Err($s)  { [Console]::Error.WriteLine($s); [Console]::Error.Flush() }

$code = @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public class EyelandWin {
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int idx);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);
  [DllImport("shell32.dll")] static extern int SHQueryUserNotificationState(out int state);

  // True when the foreground window is a full-screen app (games, F11 browser, video players, slideshows).
  public static bool IsFullscreen() {
    try {
      int q; if (SHQueryUserNotificationState(out q) == 0 && (q == 2 || q == 3 || q == 4)) return true;
      IntPtr h = GetForegroundWindow(); if (h == IntPtr.Zero) return false;
      StringBuilder sb = new StringBuilder(64); GetClassName(h, sb, 64); string c = sb.ToString();
      if (c == "Progman" || c == "WorkerW" || c == "Shell_TrayWnd" || c == "Shell_SecondaryTrayWnd") return false;
      RECT r; if (!GetWindowRect(h, out r)) return false;
      MONITORINFO mi = new MONITORINFO(); mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
      if (!GetMonitorInfo(MonitorFromWindow(h, 2), ref mi)) return false;
      bool covers = r.Left <= mi.rcMonitor.Left && r.Top <= mi.rcMonitor.Top && r.Right >= mi.rcMonitor.Right && r.Bottom >= mi.rcMonitor.Bottom;
      return covers && (GetWindowLong(h, -16) & 0x00C00000) == 0;   // covers the monitor and has no title bar
    } catch { return false; }
  }
}

public class EyelandKeys {
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
}
'@

try { Add-Type -TypeDefinition $code -ErrorAction Stop }
catch { Out-Err ("Add-Type failed: " + $_.Exception.Message); if ($_.Exception.InnerException) { Out-Err $_.Exception.InnerException.Message }; exit 2 }

# Volume, brightness, battery and network moved to the event-driven helpers (audio.ps1, power.ps1, ...).
# This script now only reports full-screen apps (no Windows notification exists for it) and sends media keys.
if ($Mode -eq 'watch') {
  $lf = $null
  while ($true) {
    $f = [EyelandWin]::IsFullscreen()
    if ($f -ne $lf) { $lf = $f; Out-Line ('fs|{0}' -f [int]$f) }
    Start-Sleep -Milliseconds 500
  }
}
elseif ($Mode -eq 'key') {
  $vk = switch ($Target) { 'play' { 0xB3 } 'next' { 0xB0 } 'prev' { 0xB1 } default { 0 } }
  if ($vk) { [EyelandKeys]::keybd_event([byte]$vk, 0, 0, [UIntPtr]::Zero); [EyelandKeys]::keybd_event([byte]$vk, 0, 2, [UIntPtr]::Zero) }
}
