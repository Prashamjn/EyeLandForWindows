// Shared plumbing for the Liquid Island native helpers (C# 5: Windows PowerShell 5.1 compiles Add-Type with csc 4.x).
// Protocol: one JSON object per line.
//   stdin : {"rid":7,"cmd":"setVolume","value":40}   (rid = request id; arguments may have their own "id", e.g. a device id)
//   stdout: {"rid":7,"ok":true,"data":{...}}  |  {"rid":7,"ok":false,"error":"...","code":"..."}  |  {"ev":"audio","data":{...}}
using System;
using System.Collections;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class LiIO {
  static readonly object L = new object();
  static TextWriter W;
  static TextWriter Out() {
    if (W == null) { W = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)); ((StreamWriter)W).AutoFlush = true; }
    return W;
  }
  // thread-safe: called from COM / WLAN / power callback threads as well as the main loop
  public static void Write(string json) { lock (L) { try { Out().WriteLine(json); } catch (Exception) { } } }
  public static void Event(string name, string dataJson) { Write("{\"ev\":" + LiJson.Str(name) + ",\"data\":" + (dataJson ?? "null") + "}"); }
  public static void Log(string msg) { try { Console.Error.WriteLine(msg); } catch (Exception) { } }
}

public class LiLine : EventArgs { public string Text; public LiLine(string t) { Text = t; } }

// Reads stdin on a background thread and raises events, so the PowerShell main loop can Wait-Event with no polling.
public class LiStdin {
  public event EventHandler<LiLine> Received;
  public event EventHandler Closed;
  public void Start() {
    Thread t = new Thread(delegate () {
      try {
        TextReader r = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
        string s;
        while ((s = r.ReadLine()) != null) { if (s.Length == 0) continue; EventHandler<LiLine> h = Received; if (h != null) h(this, new LiLine(s)); }
      } catch (Exception) { }
      EventHandler c = Closed; if (c != null) c(this, EventArgs.Empty);
    });
    t.IsBackground = true; t.Start();
  }
}

// Tiny JSON writer (no dependency on System.Web.Extensions). Values: null, bool, numbers, string, IDictionary-free: use Obj/Arr.
public class LiRaw { public string Json; public LiRaw(string j) { Json = j; } }
public static class LiJson {
  public static string Str(string s) {
    if (s == null) return "null";
    StringBuilder b = new StringBuilder("\"");
    foreach (char c in s) {
      switch (c) {
        case '"': b.Append("\\\""); break;
        case '\\': b.Append("\\\\"); break;
        case '\n': b.Append("\\n"); break;
        case '\r': b.Append("\\r"); break;
        case '\t': b.Append("\\t"); break;
        default: if (c < 0x20) b.Append("\\u" + ((int)c).ToString("x4")); else b.Append(c); break;
      }
    }
    return b.Append('"').ToString();
  }
  public static string Val(object v) {
    if (v == null) return "null";
    if (v is LiRaw) return ((LiRaw)v).Json;
    if (v is string) return Str((string)v);
    if (v is bool) return ((bool)v) ? "true" : "false";
    if (v is double) { double d = (double)v; return (double.IsNaN(d) || double.IsInfinity(d)) ? "null" : d.ToString("R", CultureInfo.InvariantCulture); }
    if (v is float) return Val((double)(float)v);
    if (v is int || v is long || v is uint || v is short || v is byte || v is ulong) return Convert.ToString(v, CultureInfo.InvariantCulture);
    if (v is IEnumerable) { StringBuilder b = new StringBuilder("["); bool first = true; foreach (object o in (IEnumerable)v) { if (!first) b.Append(','); first = false; b.Append(Val(o)); } return b.Append(']').ToString(); }
    return Str(v.ToString());
  }
  // Obj("a", 1, "b", "x") -> {"a":1,"b":"x"}
  public static string Obj(params object[] kv) {
    StringBuilder b = new StringBuilder("{");
    for (int i = 0; i + 1 < kv.Length; i += 2) { if (i > 0) b.Append(','); b.Append(Str((string)kv[i])).Append(':').Append(Val(kv[i + 1])); }
    return b.Append('}').ToString();
  }
  public static string Arr(IEnumerable items) { return Val(items); }
}

// An error with a machine-readable code (e.g. "denied", "unsupported", "not_found") that the app turns into a helpful message.
public class LiError : Exception {
  public string Code;
  public LiError(string code, string msg) : base(msg) { Code = code; }
  // A failed COM call: keeps the HRESULT visible ("... (0x80070005)") instead of a bare exception.
  public static LiError FromHr(int hr, string what) {
    string detail; try { detail = Marshal.GetExceptionForHR(hr).Message.Trim(); } catch (Exception) { detail = "COM error"; }
    return new LiError("com", what + " failed: " + detail + " (0x" + hr.ToString("X8") + ")");
  }
}
