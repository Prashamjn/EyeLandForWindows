// Connect / disconnect an already-paired classic Bluetooth device by enabling / disabling its profiles with the documented
// Win32 API BluetoothSetServiceState (bluetoothapis.h). Windows exposes no single "connect device" call; this is the supported way.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class LiBt {
  [StructLayout(LayoutKind.Sequential)] struct SystemTime { public ushort a, b, c, d, e, f, g, h; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct DevInfo {
    public uint size; public ulong address; public uint cod; public int connected, remembered, authenticated;
    public SystemTime lastSeen, lastUsed; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 248)] public string name;
  }
  [DllImport("bthprops.cpl", SetLastError = true)] static extern uint BluetoothSetServiceState(IntPtr radio, ref DevInfo dev, ref Guid service, uint flags);
  [DllImport("bthprops.cpl", SetLastError = true)] static extern uint BluetoothGetDeviceInfo(IntPtr radio, ref DevInfo dev);

  // A2DP sink, Handsfree, Headset, AVRCP target/controller, HID
  static readonly Guid[] Services = new Guid[] {
    new Guid("0000110B-0000-1000-8000-00805F9B34FB"), new Guid("0000111E-0000-1000-8000-00805F9B34FB"), new Guid("00001108-0000-1000-8000-00805F9B34FB"),
    new Guid("0000110E-0000-1000-8000-00805F9B34FB"), new Guid("00001124-0000-1000-8000-00805F9B34FB") };

  // Win32 error per profile from the last SetServices call, e.g. "1060,0,1060" (1060 = the device has no such profile, 0 = accepted)
  public static string LastCodes = "";
  // returns how many profiles accepted the change; 0 means none did (see LastCodes for why)
  public static int SetServices(ulong address, bool enable) {
    DevInfo d = new DevInfo(); d.size = (uint)Marshal.SizeOf(typeof(DevInfo)); d.address = address;
    try { BluetoothGetDeviceInfo(IntPtr.Zero, ref d); } catch (Exception) { }          // let Windows fill in name / remembered / connected for this address
    int ok = 0; List<string> codes = new List<string>();
    for (int i = 0; i < Services.Length; i++) {
      Guid g = Services[i]; uint rc = BluetoothSetServiceState(IntPtr.Zero, ref d, ref g, enable ? 1u : 0u);
      codes.Add(rc.ToString()); if (rc == 0) ok++;
    }
    LastCodes = string.Join(",", codes.ToArray());
    return ok;
  }
}
