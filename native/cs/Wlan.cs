// Wi-Fi through the Native Wifi API (wlanapi.dll) and VPN adapter detection through System.Net.NetworkInformation.
// Event-driven: WlanRegisterNotification + NetworkChange events. The helper never reads saved Wi-Fi keys.
using System;
using System.Collections.Generic;
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
  [DllImport("wlanapi.dll")] static extern int WlanCloseHandle(IntPtr h, IntPtr res);
  [DllImport("wlanapi.dll")] static extern int WlanEnumInterfaces(IntPtr h, IntPtr res, out IntPtr list);
  [DllImport("wlanapi.dll")] static extern int WlanScan(IntPtr h, ref Guid iface, IntPtr ssid, IntPtr ie, IntPtr res);
  [DllImport("wlanapi.dll")] static extern int WlanGetAvailableNetworkList(IntPtr h, ref Guid iface, uint flags, IntPtr res, out IntPtr list);
  [DllImport("wlanapi.dll")] static extern int WlanQueryInterface(IntPtr h, ref Guid iface, int op, IntPtr res, out uint size, out IntPtr data, IntPtr type);
  [DllImport("wlanapi.dll")] static extern int WlanConnect(IntPtr h, ref Guid iface, ref ConnParams p, IntPtr res);
  [DllImport("wlanapi.dll")] static extern int WlanDisconnect(IntPtr h, ref Guid iface, IntPtr res);
  [DllImport("wlanapi.dll", CharSet = CharSet.Unicode)] static extern int WlanSetProfile(IntPtr h, ref Guid iface, uint flags, string xml, string sddl, bool overwrite, IntPtr res, out uint reason);
  [DllImport("wlanapi.dll")] static extern int WlanRegisterNotification(IntPtr h, uint source, bool ignoreDup, NotifCb cb, IntPtr ctx, IntPtr res, out uint prev);
  [DllImport("wlanapi.dll")] static extern void WlanFreeMemory(IntPtr p);

  static IntPtr handle; static NotifCb cb; static Timer debounce; static string last = "";
  static string pendingPhase; static string pendingSsid;

  public static bool Init() {
    uint neg; if (WlanOpenHandle(2, IntPtr.Zero, out neg, out handle) != 0) return false;     // no WLAN service (e.g. a desktop with no Wi-Fi)
    cb = new NotifCb(OnNotify);                                                                // kept in a static so it is never collected
    uint prev; WlanRegisterNotification(handle, 0x8 /* ACM */, false, cb, IntPtr.Zero, IntPtr.Zero, out prev);
    debounce = new Timer(delegate (object o) { Emit(false); }, null, Timeout.Infinite, Timeout.Infinite);
    return true;
  }
  static void OnNotify(ref NotifData d, IntPtr ctx) {
    if (d.source != 0x8) return;
    // 9 connection_start, 10 connection_complete, 11 attempt_fail, 20 disconnecting, 21 disconnected, 13/14 interface arrival/removal, 7 scan_complete
    if (d.code == 9) { pendingPhase = "connecting"; }
    else if (d.code == 11) { pendingPhase = "failed"; }
    else if (d.code == 10) { pendingPhase = null; }
    if (d.code == 7 || d.code == 9 || d.code == 10 || d.code == 11 || d.code == 13 || d.code == 14 || d.code == 20 || d.code == 21) { if (debounce != null) debounce.Change(150, Timeout.Infinite); }
  }

  static List<Guid> Ifaces() {
    List<Guid> r = new List<Guid>(); IntPtr p;
    if (handle == IntPtr.Zero || WlanEnumInterfaces(handle, IntPtr.Zero, out p) != 0) return r;
    try {
      int n = Marshal.ReadInt32(p); IntPtr cur = new IntPtr(p.ToInt64() + 8);
      for (int i = 0; i < n; i++) { IfaceInfo ii = (IfaceInfo)Marshal.PtrToStructure(cur, typeof(IfaceInfo)); r.Add(ii.guid); cur = new IntPtr(cur.ToInt64() + Marshal.SizeOf(typeof(IfaceInfo))); }
    } finally { WlanFreeMemory(p); }
    return r;
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

  // state of the first Wi-Fi adapter: none | disconnected | connecting | connected | disconnecting
  public static string StateJson() {
    List<Guid> ifs = Ifaces();
    if (ifs.Count == 0) return LiJson.Obj("adapter", false, "state", "none", "ssid", null, "signal", 0);
    Guid g = ifs[0]; int st = IfaceState(g);
    string state = st == 1 ? "connected" : (st == 5 || st == 6 || st == 7) ? "connecting" : st == 3 ? "disconnecting" : "disconnected";
    string ssid = null; int sig = 0;
    if (st == 1) {
      IntPtr data; uint size;
      if (WlanQueryInterface(handle, ref g, 7 /* current_connection */, IntPtr.Zero, out size, out data, IntPtr.Zero) == 0) {
        try { ConnAttr a = (ConnAttr)Marshal.PtrToStructure(data, typeof(ConnAttr)); ssid = SsidStr(a.ssid); sig = (int)a.quality; } finally { WlanFreeMemory(data); }
      }
    }
    return LiJson.Obj("adapter", true, "state", pendingPhase == "connecting" && state != "connected" ? "connecting" : state, "ssid", ssid, "signal", sig, "pending", pendingPhase);
  }
  public static void Emit(bool force) {
    try {
      string j = StateJson();
      string phase = pendingPhase;
      if (phase == "failed") { LiIO.Event("wifi-progress", LiJson.Obj("phase", "failed", "ssid", pendingSsid)); pendingPhase = null; j = StateJson(); }
      if (!force && j == last) return;
      last = j; LiIO.Event("wifi", j);
    } catch (Exception e) { LiIO.Log("wifi emit: " + e.Message); }
  }

  public static string Networks(bool rescan) {
    List<Guid> ifs = Ifaces(); List<object> outl = new List<object>();
    if (ifs.Count == 0) return "[]";
    Guid g = ifs[0];
    if (rescan) { WlanScan(handle, ref g, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero); Thread.Sleep(2500); }   // results land a moment after the scan starts
    IntPtr p; if (WlanGetAvailableNetworkList(handle, ref g, 0, IntPtr.Zero, out p) != 0) return "[]";
    Dictionary<string, KeyValuePair<int, string>> best = new Dictionary<string, KeyValuePair<int, string>>();
    try {
      int n = Marshal.ReadInt32(p); IntPtr cur = new IntPtr(p.ToInt64() + 8); int sz = Marshal.SizeOf(typeof(AvailNet));
      for (int i = 0; i < n; i++, cur = new IntPtr(cur.ToInt64() + sz)) {
        AvailNet a = (AvailNet)Marshal.PtrToStructure(cur, typeof(AvailNet));
        string ssid = SsidStr(a.ssid); if (ssid.Length == 0) continue;                                    // hidden network
        bool connected = (a.flags & 1) != 0, known = (a.flags & 2) != 0;
        // auth: 1 open, 3 WPA, 4 WPA-PSK, 6 RSNA (WPA2 enterprise), 7 RSNA-PSK, 8 WPA3 enterprise-192, 9 SAE, 10 OWE
        string sec = a.secEnabled == 0 ? "open" : a.auth == 9 ? "wpa3" : a.auth == 7 || a.auth == 4 ? "wpa2" : a.auth == 10 ? "owe" : "enterprise";
        string json = LiJson.Obj("ssid", ssid, "signal", (int)a.quality, "secure", a.secEnabled != 0, "security", sec, "connected", connected, "known", known, "connectable", a.connectable != 0);
        KeyValuePair<int, string> old;
        if (!best.TryGetValue(ssid, out old) || connected || (int)a.quality > old.Key) best[ssid] = new KeyValuePair<int, string>(connected ? 1000 : (int)a.quality, json);
      }
    } finally { WlanFreeMemory(p); }
    List<KeyValuePair<int, string>> l = new List<KeyValuePair<int, string>>(best.Values);
    l.Sort(delegate (KeyValuePair<int, string> x, KeyValuePair<int, string> y) { return y.Key.CompareTo(x.Key); });
    foreach (KeyValuePair<int, string> kv in l) outl.Add(new LiRaw(kv.Value));
    return LiJson.Arr(outl);
  }

  static string Esc(string s) { return s.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;").Replace("\"", "&quot;").Replace("'", "&apos;"); }
  static string ProfileXml(string ssid, string security, string password) {
    string hex = BitConverter.ToString(Encoding.UTF8.GetBytes(ssid)).Replace("-", "");
    string auth = security == "open" ? "open" : security == "wpa3" ? "WPA3SAE" : "WPA2PSK";
    string enc = security == "open" ? "none" : "AES";
    string key = security == "open" ? "" : "<sharedKey><keyType>passPhrase</keyType><protected>false</protected><keyMaterial>" + Esc(password) + "</keyMaterial></sharedKey>";
    return "<?xml version=\"1.0\"?><WLANProfile xmlns=\"http://www.microsoft.com/networking/WLAN/profile/v1\"><name>" + Esc(ssid) + "</name><SSIDConfig><SSID><hex>" + hex + "</hex><name>" + Esc(ssid) + "</name></SSID></SSIDConfig><connectionType>ESS</connectionType><connectionMode>auto</connectionMode><MSM><security><authEncryption><authentication>" + auth + "</authentication><encryption>" + enc + "</encryption><useOneX>false</useOneX></authEncryption>" + key + "</security></MSM></WLANProfile>";
  }

  // Connects to a network. A saved profile (known=true) is reused as is; otherwise a profile is created from the password.
  // The password only ever exists in this call: it is not logged, echoed or stored by Liquid Island (Windows stores the profile, encrypted).
  public static void Connect(string ssid, string security, string password, bool known) {
    List<Guid> ifs = Ifaces(); if (ifs.Count == 0) throw new LiError("no_adapter", "No Wi-Fi adapter was found.");
    Guid g = ifs[0]; pendingSsid = ssid;
    if (security == "enterprise" && !known) throw new LiError("unsupported", "This network needs a work or school account. Connect to it from Windows settings.");
    if (!known) {
      if (security != "open" && (password == null || password.Length < 8)) throw new LiError("password", "Enter the network password (at least 8 characters).");
      uint reason; int r = WlanSetProfile(handle, ref g, 0, ProfileXml(ssid, security, password), null, true, IntPtr.Zero, out reason);
      if (r != 0) throw new LiError("profile", "Windows rejected the network settings (code " + r + ").");
    }
    ConnParams cp = new ConnParams(); cp.mode = 0; cp.profile = ssid; cp.bssType = 1; cp.flags = 0;
    int cr = WlanConnect(handle, ref g, ref cp, IntPtr.Zero);
    if (cr != 0) throw new LiError("failed", "Could not start the connection (code " + cr + ").");
    pendingPhase = "connecting"; Emit(true);
  }
  public static void Disconnect() { List<Guid> ifs = Ifaces(); if (ifs.Count == 0) return; Guid g = ifs[0]; WlanDisconnect(handle, ref g, IntPtr.Zero); }
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
    string ver; string loc = Find(out ver); string lnk = Shortcut();
    bool installed = loc != null || lnk != null;
    bool running = false;
    foreach (string pn in ProcNames) { try { Process[] ps = Process.GetProcessesByName(pn); running = running || ps.Length > 0; foreach (Process p in ps) p.Dispose(); } catch (Exception) { } }
    string adapter = null; bool up = false;
    try {
      foreach (NetworkInterface n in NetworkInterface.GetAllNetworkInterfaces()) {
        if (!IsProton(n)) continue;
        adapter = n.Name;
        if (n.OperationalStatus == OperationalStatus.Up) { up = true; break; }
      }
    } catch (Exception) { }
    // connected = the VPN's own adapter is up. If the app is not installed, never report connected.
    return LiJson.Obj("installed", installed, "version", ver, "running", running, "adapter", adapter, "connected", installed && up, "launch", lnk);
  }
  public static void Emit(bool force) {
    try { string j = StateJson(); if (!force && j == last) return; last = j; LiIO.Event("vpn", j); } catch (Exception e) { LiIO.Log("vpn emit: " + e.Message); }
  }
}
