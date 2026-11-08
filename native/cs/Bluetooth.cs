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

  // A2DP sink, Handsfree, Headset, AVRCP target/controller, HID
  static readonly Guid[] Services = new Guid[] {
    new Guid("0000110B-0000-1000-8000-00805F9B34FB"), new Guid("0000111E-0000-1000-8000-00805F9B34FB"), new Guid("00001108-0000-1000-8000-00805F9B34FB"),
    new Guid("0000110E-0000-1000-8000-00805F9B34FB"), new Guid("00001124-0000-1000-8000-00805F9B34FB") };

  // returns how many profiles accepted the change; 0 means the device exposes none of them
  public static int SetServices(ulong address, bool enable) {
    DevInfo d = new DevInfo(); d.size = (uint)Marshal.SizeOf(typeof(DevInfo)); d.address = address; int ok = 0;
    for (int i = 0; i < Services.Length; i++) { Guid g = Services[i]; if (BluetoothSetServiceState(IntPtr.Zero, ref d, ref g, enable ? 1u : 0u) == 0) ok++; }
    return ok;
  }
}
