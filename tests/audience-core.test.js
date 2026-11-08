const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../audience-core.js");

const now = Date.UTC(2026, 10, 8);
const ctx = { ownerHandle: "owner", userId: "100", cursor: null };
function url(op = "Followers", vars = { userId: "100" }) {
  return "https://x.com/i/api/graphql/query_1/" + op + "?variables=" + encodeURIComponent(JSON.stringify(vars));
}
function user(id, handle, followers, extra = {}) {
  return { __typename: "User", rest_id: id, legacy: { screen_name: handle, followers_count: followers, ...extra } };
}
function entry(u) {
  const id = u.user ? u.user.rest_id : u.rest_id;
  return { entryId: "user-" + id, content: { entryType: "TimelineTimelineItem", itemContent: { itemType: "TimelineUser", user_results: { result: u } } } };
}
function page(entries) {
  return { data: { user: { result: { rest_id: "100", timeline: { timeline: { instructions: [{ type: "TimelineAddEntries", entries }] } } } } } };
}
function record(id, followers, extra = {}) {
  return { id: String(id), handle: "user" + id, followers, observedAt: now, ...extra };
}

test("only exact HTTPS Followers operation and followers page qualify", () => {
  assert.deepEqual(A.requestContext(url(), "/OwNeR/followers"), ctx);
  assert.deepEqual(A.requestContext(url("Followers", { userId: "100", cursor: "next" }), "/owner/followers/"), { ...ctx, cursor: "next" });
  assert.ok(A.requestContext(url().replace("x.com", "twitter.com"), "/owner/followers"));
  for (const op of ["Following", "VerifiedFollowers", "FollowersYouKnow", "HomeTimeline", "Followers/extra"]) assert.equal(A.requestContext(url(op), "/owner/followers"), null);
  for (const path of ["/owner/following", "/owner/verified_followers", "/home", "/owner/followers?x=1"]) assert.equal(A.requestContext(url(), path), null);
  for (const host of ["http://x.com", "https://x.com.evil.test", "https://x.com:8443", "https://user@x.com"]) assert.equal(A.requestContext(url().replace("https://x.com", host), "/owner/followers"), null);
  for (const vars of [{}, { userId: 100 }, { userId: "1e3" }, { userId: "100", cursor: {} }]) assert.equal(A.requestContext(url("Followers", vars), "/owner/followers"), null);
  assert.equal(A.requestContext(url() + "&variables={}", "/owner/followers"), null);
});

test("only direct user entries from the requested owner's timeline are included", () => {
  const one = user("1", "first", 0, { description: "developer", location: "上海" });
  const two = { __typename: "UserWithVisibilityResults", user: { __typename: "User", rest_id: "2", core: { screen_name: "Second", name: "Second" }, relationship_counts: { followers: "1000", following: "0" }, profile_bio: { description: "designer" }, location: { location: "London" } } };
  const suggested = entry(user("3", "suggested", 500));
  const nested = { entryId: "who-to-follow-0", content: { entryType: "TimelineTimelineModule", items: [suggested] } };
  const post = { entryId: "tweet-5", content: { author: user("4", "author", 200) } };
  const promoted = entry(user("5", "promoted", 1)); promoted.content.itemContent.promotedMetadata = {};
  const p = page([entry(one), entry(two), nested, post, promoted, { entryId: "cursor-bottom-0", content: { value: "cursor" } }]);
  p.data.extra = user("6", "unrelated", 100);
  const got = A.extractPage(p, ctx, now);
  assert.equal(got.recognized, true);
  assert.deepEqual(got.errors, []);
  assert.deepEqual(got.records.map((r) => r.id), ["1", "2"]);
  assert.deepEqual(got.records.map((r) => r.location), ["上海", "London"]);
  assert.equal(got.records[0].followers, 0);
  assert.equal(got.records[1].following, 0);
  assert.equal(got.records[1].handle, "second");
  assert.equal(A.extractPage(p, { ...ctx, userId: "999" }, now).recognized, false);
  assert.deepEqual(A.extractPage(p, { ...ctx, userId: "999" }, now).records, []);
  assert.deepEqual(A.extractPage(p, { ...ctx, userId: "999" }, now).errors, []);
  p.data.user.result.core = { screen_name: "somebodyelse" };
  assert.deepEqual(A.extractPage(p, ctx, now), { records: [], recognized: false, errors: [] });
  p.data.user.result.core.screen_name = "OWNER";
  assert.equal(A.extractPage(p, ctx, now).records.length, 2);
});

test("alternate known timeline shapes work, arbitrary nested users do not", () => {
  const p = page([entry(user("1", "first", 10))]);
  const instructions = p.data.user.result.timeline.timeline.instructions;
  for (const timeline of [{ timeline_v2: { timeline: { instructions } } }, { timeline: { instructions } }]) {
    assert.equal(A.extractPage({ data: { user: { result: { rest_id: "100", ...timeline } } } }, ctx, now).records.length, 1);
  }
  assert.equal(A.extractPage({ data: { users: [user("1", "first", 10)] } }, ctx, now).recognized, false);
  const mismatch = entry(user("1", "first", 10)); mismatch.entryId = "user-999";
  const broken = page([mismatch]); broken.errors = [{ message: "upstream error" }];
  const got = A.extractPage(broken, ctx, now);
  assert.equal(got.records.length, 0);
  assert.equal(got.errors.length, 2);
  assert.equal(got.recognized, true);
  assert.equal(A.extractPage(page([]), ctx, now).recognized, true);
});

test("unknown counts remain null and zero remains valid", () => {
  for (const value of [null, undefined, "", "1.2", -1, NaN, Infinity, true, {}, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(A.normalizeRecord(record(1, value), now).followers, null);
  }
  for (const value of [0, "0"]) assert.equal(A.normalizeRecord(record(1, value), now).followers, 0);
  assert.equal(A.normalizeRecord(record(1, 100, { following: "1000" }), now).following, 1000);
  assert.equal(A.normalizeRecord(record(1, 1, { id: "not-an-id" }), now), null);
  assert.equal(A.normalizeRecord(record(1, 1, { handle: "<script>" }), now), null);
  assert.equal(A.normalizeRecord(record(1, 1, { bio: "a".repeat(2000) }), now).bio.length, 1000);
  assert.equal(A.normalizeRecord(record(1, 1, { observedAt: 1e100 }), now).observedAt, now);
  const r = A.extractPage(page([entry(user("1", "unknown", undefined))]), ctx, now).records[0];
  assert.equal(r.followers, null);
  assert.equal(r.following, null);
});

test("merge uses stable IDs, preserves known fields, caps additions and allows updates at the cap", () => {
  const old = record(1, 100, { handle: "oldname", bio: "developer", location: "SG", observedAt: now - 100 });
  const fresh = record(1, null, { handle: "newname", observedAt: now });
  const got = A.mergeRecords([old], [fresh, record(2, 10, { handle: "newname" })], 2);
  assert.equal(got.records.length, 2);
  assert.equal(got.records[0].followers, 100);
  assert.equal(got.records[0].handle, "newname");
  assert.equal(got.records[0].bio, "developer");
  assert.equal(got.records[0].location, "SG");
  const capped = A.mergeRecords(got.records, [record(3, 300), record(1, 200)], 2);
  assert.equal(capped.truncated, true);
  assert.equal(capped.records.length, 2);
  assert.equal(capped.records[0].followers, 200);
  assert.equal(A.mergeRecords(capped.records, [old], 2).records[0].followers, 200);
});

test("explicitly cleared profile text removes old labels while absent fields preserve prior text", () => {
  const before = A.extractPage(page([entry(user("1", "person", 10, { name: "Person", description: "developer", location: "Singapore" }))]), ctx, now).records;
  const absent = A.extractPage(page([entry(user("1", "person", 20))]), ctx, now + 1).records;
  assert.equal(absent[0].bio, null);
  assert.equal(absent[0].location, null);
  assert.equal(A.mergeRecords(before, absent).records[0].bio, "developer");
  const cleared = A.extractPage(page([entry(user("1", "person", 20, { name: "", description: "", location: "" }))]), ctx, now + 2).records;
  const merged = A.mergeRecords(before, cleared).records;
  assert.equal(merged[0].name, "");
  assert.equal(merged[0].bio, "");
  assert.equal(merged[0].location, "");
  assert.equal(merged[0].followers, 20);
  const analysis = A.analyze(merged);
  assert.deepEqual(analysis.topics, []);
  assert.deepEqual(analysis.locations, []);
  assert.equal(analysis.unknownTopics, 1);
  assert.equal(analysis.unknownLocations, 1);
  assert.ok(!A.toCSV(merged).includes("developer"));
  assert.ok(!A.toCSV(merged).includes("Singapore"));
  assert.equal(A.mergeRecords(merged, [record(1, 30, { handle: "person", bio: null, observedAt: now + 3 })]).records[0].bio, "");
});

test("invalid observation timestamps cannot make CSV date formatting throw", () => {
  assert.equal(A.normalizeRecord(record(1, 1, { observedAt: 1e100 }), now).observedAt, now);
  assert.equal(A.normalizeRecord(record(1, 1, { observedAt: -1 }), now).observedAt, now);
  assert.equal(A.normalizeRecord(record(1, 1, { observedAt: 8640000000000000 }), now).observedAt, 8640000000000000);
  const start = Date.now();
  const fallback = A.normalizeRecord(record(1, 1, { observedAt: 1e100 }), 1e100);
  assert.ok(fallback.observedAt >= start && fallback.observedAt <= Date.now());
  assert.doesNotThrow(() => A.toCSV([record(1, 1, { observedAt: 1e100 })]));
});

test("statistics use known counts only, exact band boundaries, multi-label bios and raw location values", () => {
  const nums = [null, 0, 99, 100, 999, 1000, 9999, 10000, 99999, 100000];
  const records = nums.map((n, i) => record(i + 1, n));
  records[0].bio = "developer and designer";
  records[0].location = "London";
  records[1].location = "london";
  const a = A.analyze(records);
  assert.equal(a.total, 10);
  assert.equal(a.knownCount, 9);
  assert.equal(a.unknownCount, 1);
  assert.equal(a.medianFollowers, 1000);
  assert.deepEqual(a.bands.map((b) => b.key), ["lt100", "lt1k", "lt10k", "lt100k", "gte100k"]);
  assert.deepEqual(a.bands.map((b) => b.count), [2, 2, 2, 2, 1]);
  assert.equal(a.topics.find((t) => t.key === "code").count, 1);
  assert.equal(a.topics.find((t) => t.key === "design").count, 1);
  assert.equal(a.unknownTopics, 9);
  assert.equal(a.locations.length, 2);
  assert.equal(a.unknownLocations, 8);
  assert.equal(A.analyze([record(1, 0), record(2, 100)]).medianFollowers, 50);
  assert.equal(A.analyze([record(1, null)]).medianFollowers, null);
  assert.equal(A.analyze([]).medianFollowers, null);
});

test("report topics reuse current bio dictionary without historical tweet scores", () => {
  const a = A.analyze([record(1, 1, { bio: "电商直播" }), record(2, 2, { bio: "chair repair" })], "电商=直播,带货");
  assert.equal(a.profiles[0].domains[0].name, "电商");
  assert.deepEqual(a.profiles[1].domains, []);
});

test("CSV escapes dangerous formulas and delimiters; unknown differs from zero", () => {
  const csv = A.toCSV([
    record(1, null, { name: '=HYPERLINK("bad")', bio: "first, line\nsecond", location: " +cmd" }),
    record(2, 0, { name: "@formula", bio: "-formula" }),
  ]);
  assert.ok(csv.startsWith('"user_id","username"'));
  assert.ok(csv.includes('"\'=HYPERLINK(""bad"")"'));
  assert.ok(csv.includes('"\'+cmd"'));
  assert.ok(csv.includes('"\'@formula"'));
  assert.ok(csv.includes('"\'-formula"'));
  assert.ok(csv.includes('"first, line\nsecond"'));
  assert.ok(csv.includes('"https://x.com/user2"'));
  assert.ok(csv.includes(',"0","",'));
  assert.ok(csv.includes(new Date(now).toISOString()));
});
