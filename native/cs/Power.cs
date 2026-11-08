// Battery / AC (GetSystemPowerStatus) and Windows 11 power mode (documented powrprof.dll *UserConfigured*PowerMode functions).
using System;
using System.Runtime.InteropServices;
using System.Threading;
using Microsoft.Win32;

public static class LiPower {
  [StructLayout(LayoutKind.Sequential)] struct SysPower { public byte ac, flag, percent, saver; public int life, full; }
  [DllImport("kernel32.dll")] static extern bool GetSystemPowerStatus(out SysPower p);
  [DllImport("powrprof.dll")] static extern uint PowerSetUserConfiguredACPowerMode(ref Guid g);
  [DllImport("powrprof.dll")] static extern uint PowerSetUserConfiguredDCPowerMode(ref Guid g);
  [DllImport("powrprof.dll")] static extern uint PowerGetUserConfiguredACPowerMode(out Guid g);
  [DllImport("powrprof.dll")] static extern uint PowerGetUserConfiguredDCPowerMode(out Guid g);
  delegate void EffCb(int mode, IntPtr ctx);
  [DllImport("powrprof.dll")] static extern uint PowerRegisterForEffectivePowerModeNotifications(uint version, EffCb cb, IntPtr ctx, out IntPtr handle);

  static readonly Guid Efficiency = new Guid("961cc777-2547-4f9d-8174-7d86181b8a7a");
  static readonly Guid Balanced = Guid.Empty;
  static readonly Guid Performance = new Guid("ded574b5-45a0-4f42-8737-46345c09c238");
  static EffCb effCb; static IntPtr effHandle; static Timer slow, debounce; static string lastBat = "", lastMode = "";

  public static void Init() {
    debounce = new Timer(delegate (object o) { EmitBattery(false); EmitMode(false); }, null, Timeout.Infinite, Timeout.Infinite);
    SystemEvents.PowerModeChanged += delegate { debounce.Change(300, Timeout.Infinite); };       // AC plugged / unplugged, resume
    try { effCb = new EffCb(delegate (int m, IntPtr c) { debounce.Change(200, Timeout.Infinite); }); PowerRegisterForEffectivePowerModeNotifications(1, effCb, IntPtr.Zero, out effHandle); } catch (Exception) { }
    slow = new Timer(delegate (object o) { EmitBattery(false); }, null, 60000, 60000);          // percentage has no change event: 1 cheap read a minute
  }

  public static string BatteryJson() {
    SysPower p; if (!GetSystemPowerStatus(out p)) return LiJson.Obj("hasBattery", false);
    bool has = (p.flag & 128) == 0 && p.flag != 255;
    return LiJson.Obj("hasBattery", has, "ac", p.ac == 1 ? (object)true : (p.ac == 0 ? (object)false : null), "charging", (p.flag & 8) != 0,
      "percent", p.percent == 255 ? (object)null : (int)p.percent, "minutes", p.life < 0 ? (object)null : (int)(p.life / 60), "saver", p.saver == 1);
  }
  public static void EmitBattery(bool force) { try { string j = BatteryJson(); if (!force && j == lastBat) return; lastBat = j; LiIO.Event("battery", j); } catch (Exception e) { LiIO.Log("battery: " + e.Message); } }

  static string Name(Guid g) { return g == Efficiency ? "efficiency" : g == Performance ? "performance" : g == Balanced ? "balanced" : "other"; }
  static bool OnAc() { SysPower p; return GetSystemPowerStatus(out p) && p.ac == 1; }
  public static string ModeJson() {
    try {
      Guid g; uint r = OnAc() ? PowerGetUserConfiguredACPowerMode(out g) : PowerGetUserConfiguredDCPowerMode(out g);
      if (r != 0) return LiJson.Obj("supported", false, "mode", null);
      return LiJson.Obj("supported", true, "mode", Name(g), "source", OnAc() ? "ac" : "battery");
    } catch (EntryPointNotFoundException) { return LiJson.Obj("supported", false, "mode", null); }
    catch (DllNotFoundException) { return LiJson.Obj("supported", false, "mode", null); }
  }
  public static void EmitMode(bool force) { try { string j = ModeJson(); if (!force && j == lastMode) return; lastMode = j; LiIO.Event("powermode", j); } catch (Exception e) { LiIO.Log("mode: " + e.Message); } }

  public static void SetMode(string mode) {
    Guid g = mode == "efficiency" ? Efficiency : mode == "performance" ? Performance : Balanced;
    uint r;
    try { r = OnAc() ? PowerSetUserConfiguredACPowerMode(ref g) : PowerSetUserConfiguredDCPowerMode(ref g); }
    catch (EntryPointNotFoundException) { throw new LiError("unsupported", "Power modes need Windows 11."); }
    if (r != 0) throw new LiError("unavailable", "Windows did not accept this power mode on this PC (code " + r + ").");
    Thread.Sleep(150);
    string now = ModeJson(); if (!now.Contains("\"mode\":\"" + mode + "\"")) throw new LiError("unavailable", "This power mode is not available on this PC right now.");
    EmitMode(true);
  }
}
