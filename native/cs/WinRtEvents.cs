// Subscribes to Windows Runtime events (Radio.StateChanged, BluetoothDevice.ConnectionStatusChanged, DeviceWatcher.*).
//
// WHY THIS EXISTS: Windows PowerShell's Register-ObjectEvent cannot subscribe to WinRT events ("Windows PowerShell cannot subscribe to
// Windows RT events"). Compiled C# can: the CLR projects WinRT events as ordinary .NET events. This class attaches to them by reflection, so the
// source needs no .winmd compile-time references (Add-Type's legacy compiler is picky about those), and re-raises each one as an ordinary .NET
// event on LiHub, which PowerShell CAN subscribe to. No polling, no extra process, no CPU while idle.
// Subscribe() never throws: it returns null on success or the full reason text, so the caller can report it and fall back to light polling.
using System;
using System.Collections.Generic;
using System.Reflection;
using System.Text;

public static class LiWinRt {
  class Sink {
    public string Tag;
    public void On(object sender, object args) {          // TypedEventHandler<TSender, TResult>: bound with delegate parameter contravariance
      try {
        LiSignalArgs a = new LiSignalArgs(Tag);
        a.Id = Prop(args, "Id"); a.Name = Prop(args, "Name");
        a.Extra = Prop(sender, "State") ?? Prop(sender, "ConnectionStatus");
        LiHub.Instance.Raise(a);
      } catch (Exception) { }
    }
  }
  class Sub { public object Target; public EventInfo Ev; public Delegate Handler; }
  static readonly Dictionary<string, Sub> subs = new Dictionary<string, Sub>();
  static readonly object L = new object();

  static string Prop(object o, string name) {
    if (o == null) return null;
    try { PropertyInfo p = o.GetType().GetProperty(name); if (p == null) return null; object v = p.GetValue(o, null); return v == null ? null : v.ToString(); }
    catch (Exception) { return null; }
  }
  static string Describe(Exception e) {
    StringBuilder sb = new StringBuilder(); int n = 0;
    while (e != null && n++ < 4) { if (sb.Length > 0) sb.Append(" <- "); sb.Append(e.GetType().Name).Append(": ").Append(e.Message.Trim()); e = e.InnerException; }
    return sb.ToString();
  }

  // returns null when subscribed, otherwise why it failed
  public static string Subscribe(string tag, object target, string eventName) {
    try {
      if (target == null) return "no object to subscribe to";
      EventInfo ev = target.GetType().GetEvent(eventName);
      if (ev == null) return "event '" + eventName + "' not found on " + target.GetType().FullName;
      Sink s = new Sink(); s.Tag = tag;
      Delegate h = Delegate.CreateDelegate(ev.EventHandlerType, s, typeof(Sink).GetMethod("On"));
      ev.AddEventHandler(target, h);
      lock (L) { Unsubscribe(tag); subs[tag] = new Sub { Target = target, Ev = ev, Handler = h }; }
      return null;
    } catch (Exception e) { return Describe(e); }
  }
  public static void Unsubscribe(string tag) {
    Sub s = null; lock (L) { if (subs.TryGetValue(tag, out s)) subs.Remove(tag); }
    if (s != null) { try { s.Ev.RemoveEventHandler(s.Target, s.Handler); } catch (Exception) { } }
  }
  public static void UnsubscribePrefix(string prefix) {
    List<string> tags = new List<string>(); lock (L) { foreach (string k in subs.Keys) if (k.StartsWith(prefix, StringComparison.Ordinal)) tags.Add(k); }
    foreach (string t in tags) Unsubscribe(t);
  }
  public static int Count { get { lock (L) { return subs.Count; } } }
}
