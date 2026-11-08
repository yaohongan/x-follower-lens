const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const core = require("../audience-core.js");

function harness() {
  const data = {};
  let receive;
  let failNextWrite = false;
  let settingsChanged;
  const copy = (v) => structuredClone(v);
  const chrome = {
    runtime: {
      id: "fixture", getURL: (p) => "chrome-extension://fixture/" + p,
      onMessage: { addListener(fn) { receive = fn; } },
    },
    storage: {
      local: {
        async get(key) { return key === null ? copy(data) : { [key]: copy(data[key]) }; },
        async set(values) {
          if (failNextWrite) { failNextWrite = false; throw new Error("QUOTA_BYTES"); }
          Object.assign(data, copy(values));
        },
        async remove(key) { delete data[key]; },
        async getBytesInUse(key) { return Buffer.byteLength(JSON.stringify(key === null ? data : { [key]: data[key] })); },
      },
      onChanged: { addListener(fn) { settingsChanged = fn; } },
    },
  };
  const context = vm.createContext({ chrome, URL, TextEncoder, console, importScripts() {}, FollowerLensAudience: core });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../audience-background.js"), "utf8"), context);
  const report = { id: "fixture", url: "chrome-extension://fixture/audience.html" };
  const page = { id: "fixture", frameId: 0, tab: { id: 1 }, url: "https://x.com/owner/followers" };
  return {
    data, report, page,
    send(action, extra = {}, sender = report) {
      return new Promise((resolve) => receive({ type: "fl-audience", action, ...extra }, sender, resolve));
    },
    capture(records, extra = {}, sender = page) {
      return this.send("capture", { ownerHandle: "owner", userId: "123", requestAt: Date.now() + 10, records, ...extra }, sender);
    },
    failWrite() { failNextWrite = true; },
    disable() {
      data.fl_settings = { enabled: false };
      settingsChanged({ fl_settings: { newValue: data.fl_settings } }, "local");
    },
  };
}
const follower = (id, count = 10) => ({ id, handle: "person" + id, followers: count, observedAt: Date.now() });

test("recording is opt-in; web content cannot start, clear or read the report", async () => {
  const h = harness();
  assert.equal((await h.capture([follower("1")])).ignored, true);
  assert.equal((await h.send("start", { ownerHandle: "owner" }, h.page)).ok, false);
  assert.equal((await h.send("get", {}, h.page)).ok, false);
  assert.equal((await h.send("start", { ownerHandle: "owner" })).ok, true);
  assert.equal((await h.send("clear", {}, h.page)).ok, false);
  assert.equal(h.data.fl_audience.ownerHandle, "owner");
});

test("target handle, numeric account ID, request epoch and top frame isolate the sample", async () => {
  const h = harness();
  await h.send("start", { ownerHandle: "owner" });
  await h.capture([follower("1")]);
  await h.capture([follower("2")], { userId: "999" });
  await h.capture([follower("3")], { requestAt: 0 });
  await h.capture([follower("4")], {}, { ...h.page, url: "https://x.com/other/followers" });
  await h.capture([follower("5")], {}, { ...h.page, frameId: 1 });
  assert.deepEqual(h.data.fl_audience.records.map((r) => r.id), ["1"]);
  assert.equal(h.data.fl_audience.userId, "123");
});

test("concurrent pages are serialized; pause and clear do not accept more records", async () => {
  const h = harness();
  await h.send("start", { ownerHandle: "owner" });
  await Promise.all([h.capture([follower("1")]), h.capture([follower("2")])]);
  assert.equal(h.data.fl_audience.records.length, 2);
  await h.send("pause");
  await h.capture([follower("3")]);
  assert.equal(h.data.fl_audience.records.length, 2);
  assert.equal((await h.send("start", { ownerHandle: "other" })).ok, false);
  await h.send("clear");
  await h.capture([follower("4")]);
  assert.equal((await h.send("get")).dataset, null);
});

test("failed persistence retains last saved sample and visibly stops recording", async () => {
  const h = harness();
  await h.send("start", { ownerHandle: "owner" });
  await h.capture([follower("1")]);
  h.failWrite();
  assert.equal((await h.capture([follower("2")])).ok, false);
  assert.equal(h.data.fl_audience.active, false);
  assert.equal(h.data.fl_audience.status, "error");
  assert.deepEqual(h.data.fl_audience.records.map((r) => r.id), ["1"]);
});

test("master switch pauses the sample and blocks restart until enabled", async () => {
  const h = harness();
  await h.send("start", { ownerHandle: "owner" });
  h.disable();
  const result = await h.send("get");
  assert.equal(result.dataset.active, false);
  assert.equal(result.dataset.status, "paused");
  assert.equal((await h.send("start", { ownerHandle: "owner" })).ok, false);
});

test("pausing still works when unrelated history fills the growth budget", async () => {
  const h = harness();
  await h.send("start", { ownerHandle: "owner" });
  h.data.unrelatedHistory = "x".repeat(8 * 1024 * 1024);
  assert.equal((await h.send("pause")).ok, true);
  assert.equal(h.data.fl_audience.active, false);
});

test("opening an already active report preserves the in-flight request epoch", async () => {
  const h = harness();
  await h.send("start", { ownerHandle: "owner" });
  h.data.fl_audience.captureAfter = 100;
  await h.send("start", { ownerHandle: "owner" });
  assert.equal(h.data.fl_audience.captureAfter, 100);
});

test("5,000-person cap stops rather than evicting already saved people", async () => {
  const h = harness();
  await h.send("start", { ownerHandle: "owner" });
  for (let page = 0; page < 5; page++) {
    await h.capture(Array.from({ length: 1000 }, (_, i) => follower(String(page * 1000 + i + 1))));
  }
  assert.equal(h.data.fl_audience.active, false);
  await h.capture([follower("5001")]);
  assert.equal(h.data.fl_audience.records.length, 5000);
  assert.equal(h.data.fl_audience.records[0].id, "1");
  assert.equal(h.data.fl_audience.active, false);
  assert.equal(h.data.fl_audience.status, "limit");
});
