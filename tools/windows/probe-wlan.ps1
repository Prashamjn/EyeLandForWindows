# Read-only probe of the Native Wifi API return codes. Run by diagnose.js (Windows PowerShell 5.1).
# The production helper (native/cs/Wlan.cs) currently IGNORES these codes, which is why a failure shows up as "No networks found".
#   0    = success
#   5    = ERROR_ACCESS_DENIED  (Windows 11 24H2+: "Let desktop apps access your location" is off, or the caller lacks permission)
#   5023 = ERROR_INVALID_STATE  (normal for WlanQueryInterface when not connected)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class LiWlanProbe {
  [DllImport("wlanapi.dll")] static extern int WlanOpenHandle(uint v, IntPtr r, out uint n, out IntPtr h);
  [DllImport("wlanapi.dll")] static extern int WlanCloseHandle(IntPtr h, IntPtr r);
  [DllImport("wlanapi.dll")] static extern int WlanEnumInterfaces(IntPtr h, IntPtr r, out IntPtr list);
  [DllImport("wlanapi.dll")] static extern int WlanScan(IntPtr h, ref Guid g, IntPtr a, IntPtr b, IntPtr c);
  [DllImport("wlanapi.dll")] static extern int WlanGetAvailableNetworkList(IntPtr h, ref Guid g, uint f, IntPtr r, out IntPtr list);
  [DllImport("wlanapi.dll")] static extern int WlanQueryInterface(IntPtr h, ref Guid g, int op, IntPtr r, out uint size, out IntPtr data, IntPtr t);
  [DllImport("wlanapi.dll")] static extern void WlanFreeMemory(IntPtr p);
  public static string Run() {
    uint neg; IntPtr h;
    int open = WlanOpenHandle(2, IntPtr.Zero, out neg, out h);
    if (open != 0) return "{\"open\":" + open + "}";
    IntPtr list; int en = WlanEnumInterfaces(h, IntPtr.Zero, out list);
    int count = 0, scan = -1, avail = -1, query = -1, nets = -1;
    if (en == 0) {
      count = Marshal.ReadInt32(list);
      if (count > 0) {
        Guid g = (Guid)Marshal.PtrToStructure(new IntPtr(list.ToInt64() + 8), typeof(Guid));
        scan = WlanScan(h, ref g, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
        System.Threading.Thread.Sleep(2500);
        IntPtr nl; avail = WlanGetAvailableNetworkList(h, ref g, 0, IntPtr.Zero, out nl);
        if (avail == 0) { nets = Marshal.ReadInt32(nl); WlanFreeMemory(nl); }
        uint sz; IntPtr d; query = WlanQueryInterface(h, ref g, 7, IntPtr.Zero, out sz, out d, IntPtr.Zero);
        if (query == 0) WlanFreeMemory(d);
      }
      WlanFreeMemory(list);
    }
    WlanCloseHandle(h, IntPtr.Zero);
    return "{\"open\":0,\"enum\":" + en + ",\"interfaces\":" + count + ",\"scan\":" + scan + ",\"availableList\":" + avail + ",\"networkCount\":" + nets + ",\"queryCurrentConnection\":" + query + "}";
  }
}
'@
[LiWlanProbe]::Run()
