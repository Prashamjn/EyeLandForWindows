// Stand-ins shaped like the WinRT classes we subscribe to: generic TypedEventHandler-style delegates, State / Id / Name properties.
using System;
public delegate void TypedHandler<TS, TR>(TS sender, TR args);
public class FakeInfo { public string Id { get; set; } public string Name { get; set; } }
public class FakeRadio {
  public string State { get; set; }
  public event TypedHandler<FakeRadio, object> StateChanged;
  public void Fire(string state) { State = state; TypedHandler<FakeRadio, object> h = StateChanged; if (h != null) h(this, null); }
}
public class FakeWatcher {
  public event TypedHandler<FakeWatcher, FakeInfo> Added;
  public void Add(string id, string name) { TypedHandler<FakeWatcher, FakeInfo> h = Added; if (h != null) h(this, new FakeInfo { Id = id, Name = name }); }
}
