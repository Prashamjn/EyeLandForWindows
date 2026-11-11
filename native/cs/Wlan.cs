// Wi-Fi through the Native Wifi API (wlanapi.dll) and VPN adapter detection through System.Net.NetworkInformation.
// Event-driven: WlanRegisterNotification (ACM + MSM sources) and NetworkChange events. The helper never reads saved Wi-Fi keys.
// Every wlanapi return code is checked. Windows 11 24H2+ answers ERROR_ACCESS_DENIED (5) to scan / network-list / current-connection
// calls unless "Let desktop apps access your location" is on: that is reported as the typed error "location_denied", never as "no networks".
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Microsoft.Win32;

public static class LiWlan {
  [StructLayout(LayoutKind.Sequential)] struct Dot11Ssid { public uint len; [MarshalAs(UnmanagedType.ByValArray, SizeConst = 32)] public byte[] ssid; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct IfaceInfo { public Guid guid; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string desc; public int state; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct AvailNet {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string profile;
    public Dot11Ssid ssid; public int bssType; public uint numBssids; public int connectable; public int notConnectableReason;
    public uint numPhy; [MarshalAs(UnmanagedType.ByValArray, SizeConst = 8)] public int[] phy; public int morePhy;
    public uint quality; public int secEnabled; public int auth; public int cipher; public uint flags; public uint reserved;
  }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct ProfileInfo { [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string name; public uint flags; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct ConnAttr {
    public int state; public int mode; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string profile;
    public Dot11Ssid ssid; public int bssType; [MarshalAs(UnmanagedType.ByValArray, SizeConst = 6)] public byte[] bssid;
    public int phyType; public uint phyIndex; public uint quality; public uint rx; public uint tx;
  }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct ConnParams { public int mode; [MarshalAs(UnmanagedType.LPWStr)] public string profile; public IntPtr ssid; public IntPtr bssids; public int bssType; public uint flags; }
  [StructLayout(LayoutKind.Sequential)] struct NotifData { public uint source; public uint code; public Guid iface; public uint size; public IntPtr data; }
  delegate void NotifCb(ref NotifData d, IntPtr ctx);

  [DllImport("wlanapi.dll")] static extern int WlanOpenHandle(uint ver, IntPtr res, out uint negotiated, out IntPtr h);
  [DllImport("wlanapi.dll")] static extern int WlanEnumInterfaces(IntPtr h, IntPtr res, out IntPtr list);
  [DllImport("wlanapi.dll")] static extern int WlanScan(IntPtr h, ref Guid iface, IntPtr ssid, IntPtr ie, IntPtr res);
  [DllImport("wlanapi.dll")] static extern int WlanGetAvailableNetworkList(IntPtr h, ref Guid iface, uint flags, IntPtr res, out IntPtr list);
  [DllImport("wlanapi.dll")] static extern int WlanGetProfileList(IntPtr h, ref Guid iface, IntPtr res, out IntPtr list);
  [DllImport("wlanapi.dll")] static extern int WlanQueryInterface(IntPtr h, ref Guid iface, int op, IntPtr res, out uint size, out IntPtr data, IntPtr type);
  [DllImport("wlanapi.dll")] static extern int WlanSetInterface(IntPtr h, ref Guid iface, int op, uint size, IntPtr data, IntPtr res);
  [DllImport("wlanapi.dll")] static extern int WlanConnect(IntPtr h, ref Guid iface, ref ConnParams p, IntPtr res);
  [DllImport("wlanapi.dll")] static extern int WlanDisconnect(IntPtr h, ref Guid iface, IntPtr res);
  [DllImport("wlanapi.dll", CharSet = CharSet.Unicode)] static extern int WlanSetProfile(IntPtr h, ref Guid iface, uint flags, string xml, string sddl, bool overwrite, IntPtr res, out uint reason);
  [DllImport("wlanapi.dll", CharSet = CharSet.Unicode)] static extern int WlanDeleteProfile(IntPtr h, ref Guid iface, string name, IntPtr res);
  [DllImport("wlanapi.dll", CharSet = CharSet.Unicode)] static extern int WlanReasonCodeToString(uint reason, int size, StringBuilder buf, IntPtr res);
  [DllImport("wlanapi.dll")] static extern int WlanRegisterNotification(IntPtr h, uint source, bool ignoreDup, NotifCb cb, IntPtr ctx, IntPtr res, out uint prev);
  [DllImport("wlanapi.dll")] static extern void WlanFreeMemory(IntPtr p);

  const int E_ACCESS_DENIED = 5;
  const uint PROFILE_USER = 2;                      // WLAN_PROFILE_USER: a per-user profile does not need the "add all-user profile" permission
  const uint SRC_ACM = 0x8, SRC_MSM = 0x10;         // WLAN_NOTIFICATION_SOURCE_ACM / _MSM
  static IntPtr handle; static NotifCb cb; static Timer debounce;
  static volatile string pendingPhase; static string pendingSsid;
  static volatile bool inConnect;                    // while Connect() waits, its own reply carries the result: no duplicate "failed" event
  static readonly object connLock = new object();
  static ManualResetEvent connDone = new ManualResetEvent(false), scanDone = new ManualResetEvent(false);
  static string connTarget; static bool connOk; static uint connReason;
  public static string InitError;

  static string Win32Msg(int code) { string m; try { m = new Win32Exception(code).Message; } catch (Exception) { m = "error"; } return m + " (code " + code + ")"; }

  public static bool Init() {
    uint neg; int rc = WlanOpenHandle(2, IntPtr.Zero, out neg, out handle);
    if (rc != 0) { InitError = "WlanOpenHandle: " + Win32Msg(rc); handle = IntPtr.Zero; return false; }   // no WLAN service (e.g. a desktop with no Wi-Fi)
    cb = new NotifCb(OnNotify);                                                                          // kept in a static so it is never collected
    uint prev; rc = WlanRegisterNotification(handle, SRC_ACM | SRC_MSM, false, cb, IntPtr.Zero, IntPtr.Zero, out prev);
    if (rc != 0) { InitError = "WlanRegisterNotification: " + Win32Msg(rc); LiIO.Log("wlan notifications unavailable: " + InitError); }
    debounce = new Timer(delegate (object o) { Emit(false); }, null, Timeout.Infinite, Timeout.Infinite);
    return true;
  }
  static void Kick(int ms) { if (debounce != null) debounce.Change(ms, Timeout.Infinite); }

  // ACM: 7 scan_complete, 9 connection_start, 10 connection_complete, 11 attempt_fail, 13/14 interface arrival/removal, 20 disconnecting, 21 disconnected
  // MSM: 7 radio_state_change (the Wi-Fi switch in Settings / the keyboard key / airplane mode / this app). MSM signal-quality noise is ignored.
  static void OnNotify(ref NotifData d, IntPtr ctx) {
    try {
      if (d.source == SRC_MSM) { if (d.code == 7) Kick(150); return; }
      if (d.source != SRC_ACM) return;
      if (d.code == 7) { scanDone.Set(); Kick(150); return; }
      if (d.code == 9) pendingPhase = "connecting";
      else if (d.code == 10 || d.code == 11) {
        // WLAN_CONNECTION_NOTIFICATION_DATA: mode(4) | profile name(256 wchar) | ssid(36) | bssType(4) | securityEnabled(4) | reasonCode(4)
        string prof = null; uint reason = 0;
        if (d.data != IntPtr.Zero && d.size >= 564) { prof = Marshal.PtrToStringUni(new IntPtr(d.data.ToInt64() + 4)); reason = (uint)Marshal.ReadInt32(d.data, 560); }
        lock (connLock) {
          if (inConnect && connTarget != null && prof != null && string.Equals(prof, connTarget, StringComparison.OrdinalIgnoreCase) && !connDone.WaitOne(0)) {
            connOk = (d.code == 10 && reason == 0); connReason = reason; connDone.Set();
          }
        }
        pendingPhase = (d.code == 11 && !inConnect) ? "failed" : null;
      }
      if (d.code == 10 || d.code == 11 || d.code == 13 || d.code == 14 || d.code == 20 || d.code == 21 || d.code == 9) Kick(150);
    } catch (Exception) { }
  }

  static List<Guid> Ifaces(out int rc) {
    List<Guid> r = new List<Guid>(); IntPtr p; rc = 0;
    if (handle == IntPtr.Zero) { rc = -1; return r; }
    rc = WlanEnumInterfaces(handle, IntPtr.Zero, out p); if (rc != 0) return r;
    try {
      int n = Marshal.ReadInt32(p); IntPtr cur = new IntPtr(p.ToInt64() + 8);
      for (int i = 0; i < n; i++) { IfaceInfo ii = (IfaceInfo)Marshal.PtrToStructure(cur, typeof(IfaceInfo)); r.Add(ii.guid); cur = new IntPtr(cur.ToInt64() + Marshal.SizeOf(typeof(IfaceInfo))); }
    } finally { WlanFreeMemory(p); }
    return r;
  }
  static Guid FirstIface() {
    int rc; List<Guid> l = Ifaces(out rc);
    if (rc != 0 && rc != -1) throw new LiError("wlan", "Windows would not list Wi-Fi adapters: " + Win32Msg(rc));
    if (l.Count == 0) throw new LiError("no_adapter", "Windows reports no Wi-Fi adapter right now.");
    return l[0];
  }
  static int IfaceState(Guid g) {
    IntPtr p; if (WlanEnumInterfaces(handle, IntPtr.Zero, out p) != 0) return -1;
    try {
      int n = Marshal.ReadInt32(p); IntPtr cur = new IntPtr(p.ToInt64() + 8);
      for (int i = 0; i < n; i++) { IfaceInfo ii = (IfaceInfo)Marshal.PtrToStructure(cur, typeof(IfaceInfo)); if (ii.guid == g) return ii.state; cur = new IntPtr(cur.ToInt64() + Marshal.SizeOf(typeof(IfaceInfo))); }
    } finally { WlanFreeMemory(p); }
    return -1;
  }
  static string SsidStr(Dot11Ssid s) { return Encoding.UTF8.GetString(s.ssid, 0, (int)Math.Min(32, s.len)); }

  // Wi-Fi radio from the WLAN API (WLAN_RADIO_STATE): no WinRT, so it works under Windows PowerShell and has change notifications.
  // returns on | off | unknown ; hardwareOff is set when a hardware switch / key forces it off
  static string RadioOf(Guid g, out bool hardwareOff, out int rc) {
    hardwareOff = false; IntPtr data; uint size;
    rc = WlanQueryInterface(handle, ref g, 4 /* radio_state */, IntPtr.Zero, out size, out data, IntPtr.Zero);
    if (rc != 0) return "unknown";
    try {
      int n = Marshal.ReadInt32(data); bool anyOn = false, anyOff = false;
      for (int i = 0; i < n && i < 64; i++) {                       // WLAN_PHY_RADIO_STATE { phyIndex, softwareState, hardwareState }, state: 1 on, 2 off
        int sw = Marshal.ReadInt32(data, 4 + i * 12 + 4), hw = Marshal.ReadInt32(data, 4 + i * 12 + 8);
        if (hw == 2) hardwareOff = true;
        if (sw == 1 && hw != 2) anyOn = true; else if (sw == 2 || hw == 2) anyOff = true;
      }
      return anyOn ? "on" : anyOff ? "off" : "unknown";
    } finally { WlanFreeMemory(data); }
  }

  // state of the first Wi-Fi adapter: none | disconnected | connecting | connected | disconnecting
  public static string StateJson() {
    int rc; List<Guid> ifs = Ifaces(out rc);
    if (ifs.Count == 0) return LiJson.Obj("adapter", false, "state", "none", "ssid", null, "signal", 0, "radio", "unknown", "listError", rc == 0 ? null : Win32Msg(rc));
    Guid g = ifs[0]; int st = IfaceState(g);
    string state = st == 1 ? "connected" : (st == 5 || st == 6 || st == 7) ? "connecting" : st == 3 ? "disconnecting" : "disconnected";
    string ssid = null, ssidError = null; int sig = 0; bool hw; int rrc; string radio = RadioOf(g, out hw, out rrc);
    if (st == 1) {
      IntPtr data; uint size; int q = WlanQueryInterface(handle, ref g, 7 /* current_connection */, IntPtr.Zero, out size, out data, IntPtr.Zero);
      if (q == 0) { try { ConnAttr a = (ConnAttr)Marshal.PtrToStructure(data, typeof(ConnAttr)); ssid = SsidStr(a.ssid); sig = (int)a.quality; } finally { WlanFreeMemory(data); } }
      else ssidError = q == E_ACCESS_DENIED ? "location_denied" : "query_failed:" + q;
    }
    return LiJson.Obj("adapter", true, "state", pendingPhase == "connecting" && state != "connected" ? "connecting" : state, "ssid", ssid, "ssidError", ssidError, "signal", sig, "pending", pendingPhase,
      "radio", radio, "hardwareOff", hw);
  }
  // Raises a signal; the PowerShell side builds the full state (it can add the WinRT SSID fallback) and sends the "wifi" event.
  public static void Emit(bool force) {
    try {
      string phase = pendingPhase;
      if (phase == "failed") { LiIO.Event("wifi-progress", LiJson.Obj("phase", "failed", "ssid", pendingSsid)); pendingPhase = null; }
      LiHub.Instance.Raise("wifi");
    } catch (Exception e) { LiIO.Log("wifi emit: " + e.Message); }
  }

  static string ClassifySecurity(AvailNet a) {
    if (a.secEnabled == 0) return "open";
    switch (a.auth) {
      case 1: case 2: return "wep";                         // 802.11 open/shared auth with security on = WEP
      case 4: return "wpa";                                 // WPA-PSK
      case 7: return "wpa2";                                // RSNA-PSK
      case 9: return "wpa3";                                // SAE
      case 10: return "owe";
      default: return "enterprise";                         // 3 WPA, 6 RSNA, 8/11 WPA3 enterprise
    }
  }

  // Names of the saved profiles. Not covered by the location gate, so saved networks stay usable when scanning is refused.
  static List<string> ProfileNames(Guid g, out int rc) {
    List<string> r = new List<string>(); IntPtr p; rc = WlanGetProfileList(handle, ref g, IntPtr.Zero, out p); if (rc != 0) return r;
    try {
      int n = Marshal.ReadInt32(p); IntPtr cur = new IntPtr(p.ToInt64() + 8); int sz = Marshal.SizeOf(typeof(ProfileInfo));
      for (int i = 0; i < n; i++, cur = new IntPtr(cur.ToInt64() + sz)) r.Add(((ProfileInfo)Marshal.PtrToStructure(cur, typeof(ProfileInfo))).name);
    } finally { WlanFreeMemory(p); }
    return r;
  }

  // { "networks": [...], "limited": bool, "reason": null | "location_denied", "scanCode": n, "listCode": n }
  public static string Networks(bool rescan) {
    Guid g = FirstIface(); int scanRc = 0;
    if (rescan) { scanDone.Reset(); scanRc = WlanScan(handle, ref g, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero); if (scanRc == 0) scanDone.WaitOne(4000); }   // wait for Windows' scan_complete, not a fixed sleep
    IntPtr p; int listRc = WlanGetAvailableNetworkList(handle, ref g, 0, IntPtr.Zero, out p);
    List<object> outl = new List<object>();
    if (scanRc == E_ACCESS_DENIED || listRc == E_ACCESS_DENIED) {
      int prc; List<string> names = ProfileNames(g, out prc);
      foreach (string n in names) outl.Add(new LiRaw(LiJson.Obj("ssid", n, "profile", n, "signal", 0, "secure", true, "security", "unknown", "connected", false, "known", true, "connectable", true, "limited", true)));
      return LiJson.Obj("networks", outl, "limited", true, "reason", "location_denied", "scanCode", scanRc, "listCode", listRc, "profileCode", prc);
    }
    if (listRc != 0) throw new LiError("wlan", "Windows would not list Wi-Fi networks: " + Win32Msg(listRc));
    if (scanRc != 0) LiIO.Log("WlanScan returned " + Win32Msg(scanRc) + "; showing Windows' cached list");
    Dictionary<string, KeyValuePair<int, string>> best = new Dictionary<string, KeyValuePair<int, string>>();
    try {
      int n = Marshal.ReadInt32(p); IntPtr cur = new IntPtr(p.ToInt64() + 8); int sz = Marshal.SizeOf(typeof(AvailNet));
      for (int i = 0; i < n; i++, cur = new IntPtr(cur.ToInt64() + sz)) {
        AvailNet a = (AvailNet)Marshal.PtrToStructure(cur, typeof(AvailNet));
        string ssid = SsidStr(a.ssid); if (ssid.Length == 0) continue;                                    // hidden network
        bool connected = (a.flags & 1) != 0, known = (a.flags & 2) != 0;
        string json = LiJson.Obj("ssid", ssid, "profile", known && a.profile != null && a.profile.Length > 0 ? a.profile : null, "signal", (int)a.quality, "secure", a.secEnabled != 0,
          "security", ClassifySecurity(a), "connected", connected, "known", known, "connectable", a.connectable != 0, "limited", false);
        KeyValuePair<int, string> old;
        if (!best.TryGetValue(ssid, out old) || connected || (int)a.quality > old.Key) best[ssid] = new KeyValuePair<int, string>(connected ? 1000 : (int)a.quality, json);
      }
    } finally { WlanFreeMemory(p); }
    List<KeyValuePair<int, string>> l = new List<KeyValuePair<int, string>>(best.Values);
    l.Sort(delegate (KeyValuePair<int, string> x, KeyValuePair<int, string> y) { return y.Key.CompareTo(x.Key); });
    foreach (KeyValuePair<int, string> kv in l) outl.Add(new LiRaw(kv.Value));
    return LiJson.Obj("networks", outl, "limited", false, "reason", null, "scanCode", scanRc, "listCode", listRc);
  }

  // A saved profile's name does not have to equal its SSID (e.g. "Home 2"): look the real name up.
  static string ProfileFor(Guid g, string ssid) {
    IntPtr p;
    if (WlanGetAvailableNetworkList(handle, ref g, 0, IntPtr.Zero, out p) == 0) {
      try {
        int n = Marshal.ReadInt32(p); IntPtr cur = new IntPtr(p.ToInt64() + 8); int sz = Marshal.SizeOf(typeof(AvailNet));
        for (int i = 0; i < n; i++, cur = new IntPtr(cur.ToInt64() + sz)) {
          AvailNet a = (AvailNet)Marshal.PtrToStructure(cur, typeof(AvailNet));
          if ((a.flags & 2) != 0 && a.profile != null && a.profile.Length > 0 && SsidStr(a.ssid) == ssid) return a.profile;
        }
      } finally { WlanFreeMemory(p); }
    }
    int rc; foreach (string nme in ProfileNames(g, out rc)) if (nme == ssid) return nme;
    return null;
  }

  static string Esc(string s) { return s.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;").Replace("\"", "&quot;").Replace("'", "&apos;"); }
  static string ProfileXml(string ssid, string security, string password) {
    string hex = BitConverter.ToString(Encoding.UTF8.GetBytes(ssid)).Replace("-", "");
    string auth = security == "open" ? "open" : security == "wpa3" ? "WPA3SAE" : security == "wpa" ? "WPAPSK" : security == "owe" ? "OWE" : "WPA2PSK";
    string enc = security == "open" ? "none" : security == "owe" ? "AES" : security == "wpa" ? "TKIP" : "AES";
    string key = (security == "open" || security == "owe") ? "" : "<sharedKey><keyType>passPhrase</keyType><protected>false</protected><keyMaterial>" + Esc(password) + "</keyMaterial></sharedKey>";
    return "<?xml version=\"1.0\"?><WLANProfile xmlns=\"http://www.microsoft.com/networking/WLAN/profile/v1\"><name>" + Esc(ssid) + "</name><SSIDConfig><SSID><hex>" + hex + "</hex><name>" + Esc(ssid) + "</name></SSID></SSIDConfig><connectionType>ESS</connectionType><connectionMode>auto</connectionMode><MSM><security><authEncryption><authentication>" + auth + "</authentication><encryption>" + enc + "</encryption><useOneX>false</useOneX></authEncryption>" + key + "</security></MSM></WLANProfile>";
  }
  static string ReasonText(uint reason) {
    StringBuilder sb = new StringBuilder(512);
    try { if (WlanReasonCodeToString(reason, sb.Capacity, sb, IntPtr.Zero) == 0 && sb.Length > 0) return sb.ToString().Trim(); } catch (Exception) { }
    return "reason 0x" + reason.ToString("X");
  }

  // Connects and returns only when Windows says the connection completed AND the adapter is really connected (or throws a typed error).
  // known=true reuses a saved profile (profile = its real name). Otherwise a PER-USER profile is created from the password; if the connection
  // fails, the profile created for this attempt is removed again so a wrong password is not saved. The password exists only inside this call.
  public static string Connect(string ssid, string security, string password, bool known, string profile) {
    Guid g = FirstIface(); pendingSsid = ssid;
    if (security == "enterprise" && !known) throw new LiError("unsupported", "This network needs a work or school account. Connect to it from Windows settings.");
    if (security == "wep" && !known) throw new LiError("unsupported", "This network uses WEP, which Liquid Island does not set up. Connect to it from Windows settings.");
    string name = profile; bool created = false;
    if (known) {
      if (string.IsNullOrEmpty(name)) name = ProfileFor(g, ssid);
      if (string.IsNullOrEmpty(name)) throw new LiError("no_profile", "Windows has no saved profile for \"" + ssid + "\". Choose it from the list and enter the password.");
    } else {
      if (security != "open" && security != "owe" && (password == null || password.Length < 8)) throw new LiError("password", "Enter the network password (at least 8 characters).");
      string xml = ProfileXml(ssid, security, password); uint reason;
      int r = WlanSetProfile(handle, ref g, PROFILE_USER, xml, null, true, IntPtr.Zero, out reason);
      if (r != 0) { LiIO.Log("WlanSetProfile(per-user) -> " + r + ", retrying as all-user"); r = WlanSetProfile(handle, ref g, 0, xml, null, true, IntPtr.Zero, out reason); }
      if (r != 0) throw new LiError("profile", "Windows rejected the network settings: " + Win32Msg(r) + (reason != 0 ? " - " + ReasonText(reason) : ""));
      name = ssid; created = true;
    }
    lock (connLock) { connTarget = name; connOk = false; connReason = 0; connDone.Reset(); inConnect = true; }
    try {
      ConnParams cp = new ConnParams(); cp.mode = 0; cp.profile = name; cp.bssType = 1; cp.flags = 0;
      pendingPhase = "connecting"; LiHub.Instance.Raise("wifi");
      int cr = WlanConnect(handle, ref g, ref cp, IntPtr.Zero);
      if (cr != 0) throw new LiError("failed", "Windows would not start the connection: " + Win32Msg(cr));
      if (!connDone.WaitOne(25000)) throw new LiError("timeout", "Windows did not finish connecting to \"" + ssid + "\" within 25 seconds.");
      if (!connOk) throw new LiError("connect_failed", "Windows could not connect to \"" + ssid + "\": " + ReasonText(connReason) + (created && security != "open" ? ". The password may be wrong." : ""));
      DateTime end = DateTime.UtcNow.AddMilliseconds(3000); bool verified = false;               // the notification says "complete": confirm the adapter agrees
      while (DateTime.UtcNow < end) { if (IfaceState(g) == 1) { verified = true; break; } Thread.Sleep(150); }
      if (!verified) throw new LiError("unverified", "Windows reported the connection as complete but the adapter is not connected.");
    } catch (LiError) {
      if (created) { try { WlanDeleteProfile(handle, ref g, name, IntPtr.Zero); } catch (Exception) { } }
      throw;
    } finally { lock (connLock) { inConnect = false; connTarget = null; } pendingPhase = null; }
    LiHub.Instance.Raise("wifi");
    return StateJson();
  }

  public static void Disconnect() {
    Guid g = FirstIface();
    int rc = WlanDisconnect(handle, ref g, IntPtr.Zero);
    if (rc != 0) throw new LiError("failed", "Windows would not disconnect: " + Win32Msg(rc));
    DateTime end = DateTime.UtcNow.AddMilliseconds(5000);
    while (DateTime.UtcNow < end) { int st = IfaceState(g); if (st != 1 && st != 3) { LiHub.Instance.Raise("wifi"); return; } Thread.Sleep(150); }
    throw new LiError("unverified", "Windows accepted the request but the adapter is still connected.");
  }

  // Sets the software radio state through the WLAN API (documented alternative to Windows.Devices.Radios) and waits until it reads back.
  public static string SetRadio(bool on) {
    Guid g = FirstIface(); bool hw; int rrc; string cur = RadioOf(g, out hw, out rrc);
    if (hw) throw new LiError("hardware_off", "Wi-Fi is switched off by a hardware switch or key on this PC. Software cannot turn it on.");
    IntPtr data; uint size; int q = WlanQueryInterface(handle, ref g, 4, IntPtr.Zero, out size, out data, IntPtr.Zero);
    if (q != 0) throw new LiError("wlan", "Windows would not report the Wi-Fi radio: " + Win32Msg(q));
    uint phyIndex = 0; try { if (Marshal.ReadInt32(data) > 0) phyIndex = (uint)Marshal.ReadInt32(data, 4); } finally { WlanFreeMemory(data); }
    IntPtr buf = Marshal.AllocHGlobal(12);
    try {
      Marshal.WriteInt32(buf, 0, (int)phyIndex); Marshal.WriteInt32(buf, 4, on ? 1 : 2); Marshal.WriteInt32(buf, 8, 0);
      int rc = WlanSetInterface(handle, ref g, 4, 12, buf, IntPtr.Zero);
      if (rc != 0) throw new LiError(rc == E_ACCESS_DENIED ? "access_denied" : "failed", "Windows would not change the Wi-Fi radio through the WLAN API: " + Win32Msg(rc));
    } finally { Marshal.FreeHGlobal(buf); }
    string want = on ? "on" : "off"; DateTime end = DateTime.UtcNow.AddMilliseconds(5000); string now = cur;
    while (DateTime.UtcNow < end) { now = RadioOf(g, out hw, out rrc); if (now == want) { LiHub.Instance.Raise("wifi"); return now; } Thread.Sleep(200); }
    throw new LiError("unverified", "Windows accepted the request but still reports the Wi-Fi radio as '" + now + "'.");
  }
}

// VPN: Proton VPN. There is no documented Windows CLI/API, so we only OBSERVE (installed app, running process, and whether its
// network adapter is up) and never touch its data, credentials or login.
public static class LiVpn {
  static string last = ""; static Timer debounce;
  static readonly string[] ProcNames = new string[] { "ProtonVPN", "ProtonVPN.Client", "ProtonVPN.Launcher", "ProtonVPN.Service", "ProtonVPNService" };
  public static void Init() {
    debounce = new Timer(delegate (object o) { Emit(false); }, null, Timeout.Infinite, Timeout.Infinite);
    NetworkChange.NetworkAddressChanged += delegate { debounce.Change(700, Timeout.Infinite); };
    NetworkChange.NetworkAvailabilityChanged += delegate { debounce.Change(700, Timeout.Infinite); };
  }
  static bool IsProton(NetworkInterface n) { string t = (n.Name + " " + n.Description).ToLowerInvariant(); return t.Contains("protonvpn") || t.Contains("proton vpn") || t.Contains("proton-vpn"); }
  // Helper adapters (leak protection, split tunnelling, driver callouts) can stay up while NOT connected: never count them as a tunnel.
  static bool IsHelperAdapter(NetworkInterface n) { string t = (n.Name + " " + n.Description).ToLowerInvariant(); return t.Contains("kill") || t.Contains("callout") || t.Contains("split") || t.Contains("leak"); }
  // a usable address: not link-local (169.254.x.x / fe80::), not loopback. A tunnel that is still negotiating has none.
  static bool HasTunnelAddress(NetworkInterface n) {
    try {
      foreach (UnicastIPAddressInformation u in n.GetIPProperties().UnicastAddresses) {
        System.Net.IPAddress a = u.Address;
        if (System.Net.IPAddress.IsLoopback(a) || a.IsIPv6LinkLocal) continue;
        byte[] b = a.GetAddressBytes(); if (b.Length == 4 && b[0] == 169 && b[1] == 254) continue;
        return true;
      }
    } catch (Exception) { }
    return false;
  }
  static string cLoc, cVer, cLnk; static DateTime cAt = DateTime.MinValue;          // the install lookup walks the registry: do it at most once a minute

  static string Find(out string version) {
    version = null; string exe = null;
    foreach (RegistryKey root in new RegistryKey[] { Registry.LocalMachine, Registry.CurrentUser }) {
      foreach (string sub in new string[] { @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall", @"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall" }) {
        try {
          using (RegistryKey k = root.OpenSubKey(sub)) {
            if (k == null) continue;
            foreach (string name in k.GetSubKeyNames()) {
              using (RegistryKey a = k.OpenSubKey(name)) {
                string dn = a == null ? null : a.GetValue("DisplayName") as string;
                if (dn != null && dn.ToLowerInvariant().Replace(" ", "").StartsWith("protonvpn")) { version = a.GetValue("DisplayVersion") as string; return a.GetValue("InstallLocation") as string ?? "installed"; }
              }
            }
          }
        } catch (Exception) { }
      }
    }
    return exe;
  }
  // a Start-menu shortcut is the supported way to launch the app
  static string Shortcut() {
    foreach (Environment.SpecialFolder f in new Environment.SpecialFolder[] { Environment.SpecialFolder.CommonPrograms, Environment.SpecialFolder.Programs }) {
      try {
        string dir = Environment.GetFolderPath(f); if (!System.IO.Directory.Exists(dir)) continue;
        foreach (string p in System.IO.Directory.GetFiles(dir, "*.lnk", System.IO.SearchOption.AllDirectories)) {
          string n = System.IO.Path.GetFileNameWithoutExtension(p).ToLowerInvariant().Replace(" ", "");
          if (n == "protonvpn") return p;
        }
      } catch (Exception) { }
    }
    return null;
  }
  public static string StateJson() {
    if ((DateTime.UtcNow - cAt).TotalSeconds > 60) { cLoc = Find(out cVer); cLnk = Shortcut(); cAt = DateTime.UtcNow; }
    string ver = cVer, loc = cLoc, lnk = cLnk;
    bool installed = loc != null || lnk != null;
    bool running = false;
    foreach (string pn in ProcNames) { try { Process[] ps = Process.GetProcessesByName(pn); running = running || ps.Length > 0; foreach (Process p in ps) p.Dispose(); } catch (Exception) { } }
    string adapter = null, evidence = "no Proton VPN network adapter found"; bool verified = false, negotiating = false;
    try {
      foreach (NetworkInterface n in NetworkInterface.GetAllNetworkInterfaces()) {
        if (!IsProton(n) || IsHelperAdapter(n)) continue;
        if (adapter == null) adapter = n.Name;
        bool up = n.OperationalStatus == OperationalStatus.Up;
        if (!up) { evidence = "adapter \"" + n.Name + "\" is " + n.OperationalStatus.ToString().ToLowerInvariant(); continue; }
        if (HasTunnelAddress(n)) { adapter = n.Name; verified = true; evidence = "adapter \"" + n.Name + "\" is up and has an address"; break; }
        negotiating = true; evidence = "adapter \"" + n.Name + "\" is up but has no address yet";
      }
    } catch (Exception e) { evidence = "could not read network adapters: " + e.Message; }
    // connected = the VPN's own tunnel adapter is up AND holds a usable address. Observation only: Proton VPN has no documented API, and
    // traffic is not probed (that would mean contacting an outside service). If the app is not installed, never report connected.
    return LiJson.Obj("installed", installed, "version", ver, "running", running, "adapter", adapter, "connected", installed && verified, "connecting", installed && negotiating && !verified, "evidence", evidence, "launch", lnk);
  }
  public static void Emit(bool force) {
    try { string j = StateJson(); if (!force && j == last) return; last = j; LiIO.Event("vpn", j); } catch (Exception e) { LiIO.Log("vpn emit: " + e.Message); }
  }
}
