// Subscribes to Windows Runtime events (Radio.StateChanged, BluetoothDevice.ConnectionStatusChanged, DeviceWatcher.*).
//
// WHY THIS EXISTS: Windows PowerShell's Register-ObjectEvent cannot subscribe to WinRT events ("Windows PowerShell cannot subscribe to
// Windows RT events"). Compiled C# can. This class attaches by reflection (no compile-time .winmd references, which Add-Type's legacy compiler
// handles badly) and re-raises each event as an ordinary .NET event on LiHub, which PowerShell CAN wait on: no polling, no idle CPU.
//
// MEASURED ON WINDOWS 11 (build 26300): EventInfo.AddEventHandler is rejected ("Adding or removing event handlers dynamically is not supported
// on WinRT events"). The C# compiler instead emits WindowsRuntimeMarshal.AddEventHandler<T>(add, remove, handler) over the token-returning
// add_/remove_ accessors, so that is strategy 1 here. Strategy 2 calls the accessor directly (also how ordinary .NET events and the Linux test fakes work).
// Subscribe() never throws: it returns null on success or the reason EACH strategy failed, so the caller can report it and fall back to light polling.
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
  class Sub { public object Target; public Delegate Handler; public string Mode; public Delegate RemoveDelegate; public MethodInfo Remove; public object Token; public Type HandlerType; }
  static readonly Dictionary<string, Sub> subs = new Dictionary<string, Sub>();
  static readonly object L = new object();
  const string TokenType = "System.Runtime.InteropServices.WindowsRuntime.EventRegistrationToken";
  const string MarshalType = "System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeMarshal";

  static string Prop(object o, string name) {
    if (o == null) return null;
    try { PropertyInfo p = o.GetType().GetProperty(name); if (p == null) return null; object v = p.GetValue(o, null); return v == null ? null : v.ToString(); }
    catch (Exception) { return null; }
  }
  static string Describe(Exception e) {
    while (e is TargetInvocationException && e.InnerException != null) e = e.InnerException;
    StringBuilder sb = new StringBuilder(); int n = 0;
    while (e != null && n++ < 4) { if (sb.Length > 0) sb.Append(" <- "); sb.Append(e.GetType().Name).Append(": ").Append(e.Message.Trim()); e = e.InnerException; }
    return sb.ToString();
  }
  static MethodInfo Marshal_(string name, int genericArgs) {
    Type t = Type.GetType(MarshalType + ", mscorlib"); if (t == null) t = Type.GetType(MarshalType);
    if (t == null) return null;
    foreach (MethodInfo m in t.GetMethods(BindingFlags.Public | BindingFlags.Static)) if (m.Name == name && m.IsGenericMethodDefinition && m.GetGenericArguments().Length == genericArgs) return m;
    return null;
  }

  // returns null when subscribed, otherwise why each strategy failed
  public static string Subscribe(string tag, object target, string eventName) {
    List<string> why = new List<string>();
    try {
      if (target == null) return "no object to subscribe to";
      EventInfo ev = target.GetType().GetEvent(eventName);
      if (ev == null) return "event '" + eventName + "' not found on " + target.GetType().FullName;
      MethodInfo add = ev.GetAddMethod(true), rem = ev.GetRemoveMethod(true);
      if (add == null || rem == null) return "event '" + eventName + "' has no add/remove accessor";
      Sink s = new Sink(); s.Tag = tag;
      Delegate h = Delegate.CreateDelegate(ev.EventHandlerType, s, typeof(Sink).GetMethod("On"));
      Sub sub = new Sub(); sub.Target = target; sub.Handler = h; sub.HandlerType = ev.EventHandlerType;

      // Strategy 1: what the C# compiler emits for a WinRT event: WindowsRuntimeMarshal.AddEventHandler<T>(Func<T, token> add, Action<token> remove, T handler)
      if (add.ReturnType.FullName == TokenType) {
        try {
          Type token = add.ReturnType;
          Type addT = typeof(Func<,>).MakeGenericType(ev.EventHandlerType, token), remT = typeof(Action<>).MakeGenericType(token);
          Delegate addD = Delegate.CreateDelegate(addT, target, add), remD = Delegate.CreateDelegate(remT, target, rem);
          MethodInfo m = Marshal_("AddEventHandler", 1);
          if (m == null) throw new NotSupportedException("WindowsRuntimeMarshal.AddEventHandler is not available in this runtime");
          m.MakeGenericMethod(ev.EventHandlerType).Invoke(null, new object[] { addD, remD, h });
          sub.Mode = "marshal"; sub.RemoveDelegate = remD;
          lock (L) { Unsubscribe(tag); subs[tag] = sub; }
          return null;
        } catch (Exception e) { why.Add("WindowsRuntimeMarshal: " + Describe(e)); }
      } else why.Add("WindowsRuntimeMarshal skipped (add accessor returns " + add.ReturnType.Name + ")");

      // Strategy 2: call the add accessor directly (ordinary .NET events; also a WinRT accessor that is directly callable)
      try {
        object token = add.Invoke(target, new object[] { h });
        sub.Mode = "direct"; sub.Remove = rem; sub.Token = token;
        lock (L) { Unsubscribe(tag); subs[tag] = sub; }
        return null;
      } catch (Exception e) { why.Add("direct accessor: " + Describe(e)); }
    } catch (Exception e) { why.Add(Describe(e)); }
    return string.Join(" | ", why.ToArray());
  }

  public static void Unsubscribe(string tag) {
    Sub s = null; lock (L) { if (subs.TryGetValue(tag, out s)) subs.Remove(tag); }
    if (s == null) return;
    try {
      if (s.Mode == "marshal") {
        MethodInfo m = Marshal_("RemoveEventHandler", 1);
        if (m != null) m.MakeGenericMethod(s.HandlerType).Invoke(null, new object[] { s.RemoveDelegate, s.Handler });
      } else if (s.Mode == "direct") {
        ParameterInfo[] ps = s.Remove.GetParameters();
        bool takesToken = ps.Length == 1 && ps[0].ParameterType.FullName == TokenType;
        s.Remove.Invoke(s.Target, new object[] { takesToken ? s.Token : (object)s.Handler });
      }
    } catch (Exception) { }
  }
  public static void UnsubscribePrefix(string prefix) {
    List<string> tags = new List<string>(); lock (L) { foreach (string k in subs.Keys) if (k.StartsWith(prefix, StringComparison.Ordinal)) tags.Add(k); }
    foreach (string t in tags) Unsubscribe(t);
  }
  public static int Count { get { lock (L) { return subs.Count; } } }
}
