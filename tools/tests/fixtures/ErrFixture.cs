using System; using System.Runtime.InteropServices; using System.Threading.Tasks;
public static class ErrFixture {
  public static void ThrowTyped() { throw new LiError("password", "Enter the network password."); }
  public static void ThrowCom() { throw new COMException("The device is busy", unchecked((int)0x80070005)); }
  public static void ThrowPlain() { throw new InvalidOperationException("plain failure"); }
  public static void ThrowDeep() { try { throw new LiError("location_denied", "Location is off."); } catch (LiError e) { throw new InvalidOperationException("outer", e); } }
  public static void WaitOnFailedTask() { Task.Run(delegate () { ThrowTyped(); }).Wait(); }   // AggregateException, like a failed WinRT await
  public static int Ok() { return 7; }
}
