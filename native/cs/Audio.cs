// Core Audio (MMDevice / endpoint volume). Event-driven: no polling. Never opens an audio stream, so the microphone is only
// queried for its mute flag and name, never recorded.
// Switching the default device uses IPolicyConfig. That interface is NOT documented by Microsoft (there is no public API for it);
// it is the mechanism used by Windows' own Sound settings and by SoundSwitch / AudioDeviceCmdlets. See PHASE_2_COMPLETION_REPORT.md.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
  [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
  [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
  [PreserveSig] int RegisterEndpointNotificationCallback(IMMNotificationClient client);
  [PreserveSig] int UnregisterEndpointNotificationCallback(IMMNotificationClient client);
}
[ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceCollection {
  [PreserveSig] int GetCount(out uint count);
  [PreserveSig] int Item(uint index, out IMMDevice device);
}
[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
  [PreserveSig] int OpenPropertyStore(int access, out IPropertyStore props);
  [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
  [PreserveSig] int GetState(out int state);
}
[ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPropertyStore {
  [PreserveSig] int GetCount(out uint count);
  [PreserveSig] int GetAt(uint index, out PropertyKey key);
  [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
  [PreserveSig] int SetValue(ref PropertyKey key, ref PropVariant value);
  [PreserveSig] int Commit();
}
[StructLayout(LayoutKind.Sequential)] struct PropertyKey { public Guid fmtid; public uint pid; }
[StructLayout(LayoutKind.Sequential)] struct PropVariant { public ushort vt; public ushort r1; public ushort r2; public ushort r3; public IntPtr p; public IntPtr p2; }

[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  [PreserveSig] int RegisterControlChangeNotify(IAudioEndpointVolumeCallback cb);
  [PreserveSig] int UnregisterControlChangeNotify(IAudioEndpointVolumeCallback cb);
  [PreserveSig] int GetChannelCount(out uint c);
  [PreserveSig] int SetMasterVolumeLevel(float l, ref Guid g);
  [PreserveSig] int SetMasterVolumeLevelScalar(float l, ref Guid g);
  [PreserveSig] int GetMasterVolumeLevel(out float l);
  [PreserveSig] int GetMasterVolumeLevelScalar(out float l);
  [PreserveSig] int SetChannelVolumeLevel(uint n, float l, ref Guid g);
  [PreserveSig] int SetChannelVolumeLevelScalar(uint n, float l, ref Guid g);
  [PreserveSig] int GetChannelVolumeLevel(uint n, out float l);
  [PreserveSig] int GetChannelVolumeLevelScalar(uint n, out float l);
  [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool m, ref Guid g);
  [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool m);
}
[ComImport, Guid("657804FA-D6AD-4496-8A60-352752AF4F89"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolumeCallback { [PreserveSig] int OnNotify(IntPtr notifyData); }

[ComImport, Guid("7991EEC9-7E89-4D85-8390-6C703CEC60C0"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMNotificationClient {
  [PreserveSig] int OnDeviceStateChanged([MarshalAs(UnmanagedType.LPWStr)] string id, int newState);
  [PreserveSig] int OnDeviceAdded([MarshalAs(UnmanagedType.LPWStr)] string id);
  [PreserveSig] int OnDeviceRemoved([MarshalAs(UnmanagedType.LPWStr)] string id);
  [PreserveSig] int OnDefaultDeviceChanged(int flow, int role, [MarshalAs(UnmanagedType.LPWStr)] string id);
  [PreserveSig] int OnPropertyValueChanged([MarshalAs(UnmanagedType.LPWStr)] string id, PropertyKey key);
}

[ComImport, Guid("F8679F50-850A-41CF-9C72-430F290290C8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPolicyConfig {   // vtable order matters; unused members are declared only to keep the layout
  [PreserveSig] int GetMixFormat([MarshalAs(UnmanagedType.LPWStr)] string d, IntPtr f);
  [PreserveSig] int GetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string d, int def, IntPtr f);
  [PreserveSig] int ResetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string d);
  [PreserveSig] int SetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string d, IntPtr a, IntPtr b);
  [PreserveSig] int GetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string d, int def, IntPtr a, IntPtr b);
  [PreserveSig] int SetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string d, IntPtr a);
  [PreserveSig] int GetShareMode([MarshalAs(UnmanagedType.LPWStr)] string d, IntPtr m);
  [PreserveSig] int SetShareMode([MarshalAs(UnmanagedType.LPWStr)] string d, IntPtr m);
  [PreserveSig] int GetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string d, int b, IntPtr k, IntPtr v);
  [PreserveSig] int SetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string d, int b, IntPtr k, IntPtr v);
  [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string d, int role);
  [PreserveSig] int SetEndpointVisibility([MarshalAs(UnmanagedType.LPWStr)] string d, int v);
}

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCom { }
[ComImport, Guid("870AF99C-171D-4F9E-AF0D-E63DF40C2BC9")] class PolicyConfigClientCom { }

[ClassInterface(ClassInterfaceType.None)]
class LiNotifClient : IMMNotificationClient {
  public int OnDeviceStateChanged(string id, int s) { LiAudio.Changed(true); return 0; }
  public int OnDeviceAdded(string id) { LiAudio.Changed(true); return 0; }
  public int OnDeviceRemoved(string id) { LiAudio.Changed(true); return 0; }
  public int OnDefaultDeviceChanged(int flow, int role, string id) { if (role == 1) LiAudio.Changed(true); return 0; }
  public int OnPropertyValueChanged(string id, PropertyKey k) { return 0; }
}
[ClassInterface(ClassInterfaceType.None)]
class LiVolCallback : IAudioEndpointVolumeCallback { public int OnNotify(IntPtr data) { LiAudio.Changed(false); return 0; } }

public static class LiAudio {
  const int Render = 0, Capture = 1, RoleMultimedia = 1, StateActive = 1;
  static IMMDeviceEnumerator en;
  static LiNotifClient notif = new LiNotifClient();
  static LiVolCallback volCb = new LiVolCallback();
  static IAudioEndpointVolume regRender, regCapture;
  static string lastJson = "";
  static Timer debounce;
  static bool devicesDirty;
  static readonly object L = new object();
  [DllImport("ole32.dll")] static extern int PropVariantClear(ref PropVariant pv);

  public static void Init() {
    en = (IMMDeviceEnumerator)(new MMDeviceEnumeratorCom());
    en.RegisterEndpointNotificationCallback(notif);
    debounce = new Timer(delegate (object o) { Emit(false); }, null, Timeout.Infinite, Timeout.Infinite);
    Rebind();
    Emit(true);
  }
  // events arrive on COM threads in bursts: coalesce
  public static void Changed(bool devices) { if (devices) devicesDirty = true; if (debounce != null) debounce.Change(120, Timeout.Infinite); }

  static IMMDevice Default(int flow) { IMMDevice d; return (en.GetDefaultAudioEndpoint(flow, RoleMultimedia, out d) == 0) ? d : null; }
  static IAudioEndpointVolume Vol(IMMDevice d) {
    if (d == null) return null;
    Guid g = typeof(IAudioEndpointVolume).GUID; object o;
    return (d.Activate(ref g, 23, IntPtr.Zero, out o) == 0) ? (IAudioEndpointVolume)o : null;
  }
  static string IdOf(IMMDevice d) { string id; return (d != null && d.GetId(out id) == 0) ? id : null; }
  static string NameOf(IMMDevice d) {
    try {
      IPropertyStore ps; if (d.OpenPropertyStore(0, out ps) != 0) return "Unknown device";
      PropertyKey k = new PropertyKey(); k.fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"); k.pid = 14;   // PKEY_Device_FriendlyName
      PropVariant v; string s = null;
      if (ps.GetValue(ref k, out v) == 0) { if (v.vt == 31) s = Marshal.PtrToStringUni(v.p); PropVariantClear(ref v); }
      return string.IsNullOrEmpty(s) ? "Unknown device" : s;
    } catch (Exception) { return "Unknown device"; }
  }
  // (re)attach volume callbacks to whichever devices are the defaults now
  static void Rebind() {
    lock (L) {
      try { if (regRender != null) regRender.UnregisterControlChangeNotify(volCb); } catch (Exception) { }
      try { if (regCapture != null) regCapture.UnregisterControlChangeNotify(volCb); } catch (Exception) { }
      regRender = Vol(Default(Render)); regCapture = Vol(Default(Capture));
      try { if (regRender != null) regRender.RegisterControlChangeNotify(volCb); } catch (Exception) { }
      try { if (regCapture != null) regCapture.RegisterControlChangeNotify(volCb); } catch (Exception) { }
    }
  }

  // PKEY_AudioEndpoint_FormFactor: 1 speakers, 3 headphones, 5 headset, ... (-1 if the driver does not say)
  static int FormOf(IMMDevice d) {
    try {
      IPropertyStore ps; if (d.OpenPropertyStore(0, out ps) != 0) return -1;
      PropertyKey k = new PropertyKey(); k.fmtid = new Guid("1da5d803-d492-4edd-8c23-e0c0ffee7f0e"); k.pid = 0;
      PropVariant v; int r = -1;
      if (ps.GetValue(ref k, out v) == 0) { if (v.vt == 19) r = (int)v.p.ToInt64(); PropVariantClear(ref v); }
      return r;
    } catch (Exception) { return -1; }
  }
  static string OutputsJson(string defId) {
    List<string> items = new List<string>();
    IMMDeviceCollection col;
    if (en.EnumAudioEndpoints(Render, StateActive, out col) == 0) {
      uint n; col.GetCount(out n);
      for (uint i = 0; i < n; i++) {
        IMMDevice d; if (col.Item(i, out d) != 0) continue;
        string id = IdOf(d);
        items.Add(LiJson.Obj("id", id, "name", NameOf(d), "form", FormOf(d), "default", id == defId));
      }
    }
    return LiJson.Arr(items.ConvertAll<object>(delegate (string s) { return new LiRaw(s); }));
  }
  public static string StateJson() {
    lock (L) {
      IMMDevice dr = Default(Render), dc = Default(Capture);
      float v = 0; bool m = false; bool hasR = false;
      if (regRender != null) { hasR = regRender.GetMasterVolumeLevelScalar(out v) == 0; regRender.GetMute(out m); }
      float cv = 0; bool cm = false; bool hasC = false;
      if (regCapture != null) { hasC = regCapture.GetMasterVolumeLevelScalar(out cv) == 0; regCapture.GetMute(out cm); }
      string defId = IdOf(dr);
      string audio = LiJson.Obj("available", hasR, "volume", (int)Math.Round(v * 100), "muted", m, "outId", defId, "outName", dr != null ? NameOf(dr) : null, "outputs", new LiRaw(OutputsJson(defId)));
      string mic = LiJson.Obj("present", dc != null, "muted", cm, "name", dc != null ? NameOf(dc) : null, "id", IdOf(dc), "level", hasC ? (int)Math.Round(cv * 100) : -1);
      return LiJson.Obj("audio", new LiRaw(audio), "mic", new LiRaw(mic));
    }
  }
  public static void Emit(bool force) {
    try {
      if (devicesDirty) { devicesDirty = false; Rebind(); }
      string j = StateJson();
      if (!force && j == lastJson) return;
      lastJson = j; LiIO.Event("audio", j);
    } catch (Exception e) { LiIO.Log("audio emit: " + e.Message); }
  }

  static void Chk(int hr, string what) { if (hr < 0) throw LiError.FromHr(hr, what); }
  public static void SetVolume(int v) {
    lock (L) { if (regRender == null) throw new LiError("no_device", "Windows reports no sound output device.");
      Guid g = Guid.Empty;
      Chk(regRender.SetMasterVolumeLevelScalar(Math.Max(0, Math.Min(100, v)) / 100f, ref g), "Setting the volume");
      if (v > 0) { int hr = regRender.SetMute(false, ref g); if (hr < 0) LiIO.Log("unmute after volume change failed: 0x" + hr.ToString("X8")); } }
  }
  public static void SetMute(bool m) { lock (L) { if (regRender == null) throw new LiError("no_device", "Windows reports no sound output device."); Guid g = Guid.Empty; Chk(regRender.SetMute(m, ref g), "Changing mute"); } }
  public static void SetMicMute(bool m) { lock (L) { if (regCapture == null) throw new LiError("no_device", "Windows reports no microphone."); Guid g = Guid.Empty; Chk(regCapture.SetMute(m, ref g), "Changing microphone mute (some drivers do not support it)"); } }
  static string RoleName(int r) { return r == 0 ? "console" : r == 1 ? "multimedia" : "communications"; }
  // Makes the device the default for all three roles, then waits until Windows ITSELF reports it as the default; returns the real state.
  public static string SetDefaultOutput(string id) {
    IMMDevice d = null; int hr = en.GetDevice(id, out d);                           // only ids that are currently active render endpoints are accepted
    if (hr != 0 || d == null) throw new LiError("not_found", "That sound device is not available. It may have been unplugged.");
    int st; d.GetState(out st); if (st != StateActive) throw new LiError("not_found", "That sound device is not active right now.");
    List<string> roleErrors = new List<string>(); IPolicyConfig pc = null;
    try {
      try { pc = (IPolicyConfig)(new PolicyConfigClientCom()); }
      catch (COMException e) { throw LiError.FromHr(e.ErrorCode, "Creating Windows' audio policy object"); }
      catch (InvalidCastException e) { throw new LiError("com", "Windows did not provide the audio policy interface (IPolicyConfig): " + e.Message); }
      for (int role = 0; role < 3; role++) { int h = pc.SetDefaultEndpoint(id, role); if (h != 0) roleErrors.Add(RoleName(role) + " 0x" + h.ToString("X8")); }
    } finally { if (pc != null) { try { Marshal.ReleaseComObject(pc); } catch (Exception) { } } try { Marshal.ReleaseComObject(d); } catch (Exception) { } }
    string now = null; DateTime end = DateTime.UtcNow.AddMilliseconds(2500);
    while (DateTime.UtcNow < end) { lock (L) { now = IdOf(Default(Render)); } if (now == id) break; Thread.Sleep(80); }
    if (roleErrors.Count > 0) LiIO.Log("SetDefaultEndpoint role errors: " + string.Join("; ", roleErrors.ToArray()));
    if (now != id) {
      if (roleErrors.Count > 0) throw new LiError("com", "Windows refused to change the default output (" + string.Join("; ", roleErrors.ToArray()) + ").");
      throw new LiError("unverified", "Windows accepted the request but the default output is still the previous device.");
    }
    devicesDirty = true; Rebind(); Emit(true);
    return StateJson();
  }
}
