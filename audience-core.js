// 粉丝样本的来源校验、规范化和统计。纯函数，不读页面、不访问网络或存储。
(function (root) {
  "use strict";
  const P = typeof module !== "undefined" && module.exports ? require("./parse.js") : root.FollowerLensParse;
  const HANDLE = /^[a-zA-Z0-9_]{1,15}$/;
  const ID = /^\d{1,30}$/;
  const BANDS = [
    { key: "lt100", label: "0–99", min: 0, max: 100 },
    { key: "lt1k", label: "100–999", min: 100, max: 1000 },
    { key: "lt10k", label: "1,000–9,999", min: 1000, max: 10000 },
    { key: "lt100k", label: "10,000–99,999", min: 10000, max: 100000 },
    { key: "gte100k", label: "100,000+", min: 100000, max: Infinity },
  ];
  // null 表示响应未提供字段；空字符串表示这次观测确实是空值，合并时应清除旧内容。
  const text = (value, limit) => typeof value === "string" ? value.trim().slice(0, limit) : null;
  const timestamp = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 8640000000000000;
  const count = (value) => {
    if (typeof value === "string") {
      if (!/^\d+$/.test(value)) return null;
      value = Number(value);
    }
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
  };
  function date(value) {
    if (typeof value !== "string" || !value.trim()) return null;
    const ts = Date.parse(value);
    return Number.isFinite(ts) ? new Date(ts).toISOString() : null;
  }

  // pagePath 必须是在请求发出时记录的路径，不能使用响应抵达时的新页面路径。
  function requestContext(requestUrl, pagePath) {
    if (typeof requestUrl !== "string" || requestUrl.length > 16384 || typeof pagePath !== "string") return null;
    const page = pagePath.match(/^\/([a-zA-Z0-9_]{1,15})\/followers\/?$/);
    if (!page) return null;
    try {
      const url = new URL(requestUrl);
      if (!["https://x.com", "https://twitter.com"].includes(url.origin) || url.username || url.password) return null;
      if (!/^\/i\/api\/graphql\/[a-zA-Z0-9_-]+\/Followers$/.test(url.pathname)) return null;
      if (url.searchParams.getAll("variables").length !== 1) return null;
      const vars = JSON.parse(url.searchParams.get("variables"));
      if (!vars || typeof vars.userId !== "string" || !ID.test(vars.userId)) return null;
      if (vars.cursor !== undefined && (typeof vars.cursor !== "string" || vars.cursor.length > 4096)) return null;
      return { ownerHandle: page[1].toLowerCase(), userId: vars.userId, cursor: vars.cursor || null };
    } catch (_) { return null; }
  }

  function normalizeRecord(input, now) {
    if (!input || typeof input !== "object" || typeof input.id !== "string" || !ID.test(input.id)) return null;
    const handle = (text(input.handle, 100) || "").replace(/^@/, "");
    if (!HANDLE.test(handle)) return null;
    const fallbackTime = timestamp(now) ? now : Date.now();
    return {
      id: input.id,
      handle: handle.toLowerCase(),
      name: text(input.name, 160),
      bio: text(input.bio, 1000),
      location: text(input.location, 200),
      followers: count(input.followers),
      following: count(input.following),
      createdAt: date(input.createdAt),
      observedAt: timestamp(input.observedAt) ? input.observedAt : fallbackTime,
    };
  }

  function readListUser(result, now) {
    const u = result && result.__typename === "UserWithVisibilityResults" ? result.user : result;
    if (!u || (u.__typename && u.__typename !== "User")) return null;
    const legacy = u.legacy || {}, core = u.core || {}, rc = u.relationship_counts || {};
    return normalizeRecord({
      id: u.rest_id,
      handle: core.screen_name || legacy.screen_name,
      name: core.name ?? legacy.name,
      bio: (u.profile_bio && u.profile_bio.description) ?? legacy.description,
      location: (u.location && typeof u.location === "object" ? u.location.location : u.location) ?? legacy.location,
      followers: rc.followers ?? legacy.followers_count ?? u.followers_count,
      following: rc.following ?? legacy.friends_count ?? u.friends_count,
      createdAt: core.created_at || legacy.created_at,
      observedAt: now,
    }, now);
  }

  // 只沿 Followers 时间线的直接用户条目取数据；不递归遍历推荐模块、帖子作者等。
  function extractPage(json, context, now) {
    const out = { records: [], recognized: false, errors: [] };
    if (!context || typeof context.userId !== "string" || !ID.test(context.userId) || !HANDLE.test(context.ownerHandle || "")) return out;
    if (!json || typeof json !== "object") return out;
    if (Array.isArray(json.errors) && json.errors.length) out.errors.push("X 返回了部分数据错误，本页可能不完整。");
    const result = json.data && json.data.user && json.data.user.result;
    if (!result || typeof result !== "object") return out;
    // 不属于目标账号的响应直接忽略，也不应让它的 errors 停止正确账号的采集。
    if (result.rest_id !== undefined && result.rest_id !== context.userId) return { records: [], recognized: false, errors: [] };
    const ownerHandle = result.core && result.core.screen_name || result.legacy && result.legacy.screen_name;
    if (ownerHandle !== undefined && (typeof ownerHandle !== "string" || ownerHandle.toLowerCase() !== context.ownerHandle.toLowerCase())) return { records: [], recognized: false, errors: [] };
    const instructions = result.timeline && result.timeline.timeline && result.timeline.timeline.instructions
      || result.timeline_v2 && result.timeline_v2.timeline && result.timeline_v2.timeline.instructions
      || result.timeline && result.timeline.instructions;
    if (!Array.isArray(instructions)) return out;
    out.recognized = true;
    let skipped = false;
    for (const instruction of instructions) {
      if (!instruction || instruction.type !== "TimelineAddEntries" || !Array.isArray(instruction.entries)) continue;
      for (const entry of instruction.entries) {
        if (!entry || typeof entry.entryId !== "string") continue;
        const id = entry.entryId.match(/^user-(\d{1,30})$/);
        if (!id) continue;
        const content = entry.content;
        if (!content || content.entryType !== "TimelineTimelineItem" || content.promotedMetadata) continue;
        const item = content.itemContent;
        if (!item || item.itemType !== "TimelineUser" || item.promotedMetadata) continue;
        const record = readListUser(item.user_results && item.user_results.result, now);
        if (!record || record.id !== id[1]) { skipped = true; continue; }
        out.records.push(record);
      }
    }
    if (skipped) out.errors.push("部分粉丝资料不可用或字段格式无法识别，已跳过。");
    out.records = mergeRecords([], out.records, 5000).records;
    return out;
  }

  // 账号更名仍以 ID 去重；缺失字段不覆盖已知字段，较旧的观测也不会回退新数据。
  function mergeRecords(existing, incoming, max) {
    const limit = Number.isSafeInteger(max) && max >= 0 ? max : 5000;
    const records = new Map();
    let truncated = false;
    for (const value of [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])]) {
      const next = normalizeRecord(value);
      if (!next) continue;
      const prev = records.get(next.id);
      if (!prev) {
        if (records.size >= limit) { truncated = true; continue; }
        records.set(next.id, next);
        continue;
      }
      const newer = next.observedAt >= prev.observedAt ? next : prev;
      const older = newer === next ? prev : next;
      const merged = { ...older, ...newer };
      for (const key of ["followers", "following", "createdAt", "name", "bio", "location"]) if (newer[key] === null) merged[key] = older[key];
      records.set(next.id, merged);
    }
    return { records: [...records.values()], truncated };
  }

  function analyze(records, customDomains) {
    const profiles = mergeRecords([], records, Number.MAX_SAFE_INTEGER).records.map((r) => ({
      ...r, domains: P.pickDomains(r.bio, {}, customDomains || ""),
    }));
    const known = profiles.filter((r) => r.followers !== null).map((r) => r.followers).sort((a, b) => a - b);
    const bands = BANDS.map((b) => ({ key: b.key, label: b.label, count: known.filter((v) => v >= b.min && v < b.max).length }));
    const topics = new Map(), locations = new Map();
    let unknownTopics = 0, unknownLocations = 0;
    for (const r of profiles) {
      if (!r.domains.length) unknownTopics++;
      for (const d of r.domains) {
        const t = topics.get(d.key) || { key: d.key, name: d.name, count: 0 };
        t.count++; topics.set(d.key, t);
      }
      if (!r.location) unknownLocations++;
      else locations.set(r.location, (locations.get(r.location) || 0) + 1);
    }
    const mid = known.length >> 1;
    return {
      total: profiles.length,
      knownCount: known.length,
      unknownCount: profiles.length - known.length,
      medianFollowers: !known.length ? null : known.length % 2 ? known[mid] : known[mid - 1] + (known[mid] - known[mid - 1]) / 2,
      bands,
      topics: [...topics.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      unknownTopics,
      locations: [...locations].map(([name, n]) => ({ name, count: n })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      unknownLocations,
      profiles,
    };
  }

  function csvCell(value) {
    let s = value === null || value === undefined ? "" : String(value);
    // 引号只解决 CSV 分隔，不阻止表格公式；危险前缀另加单引号。
    if (/^[\s\uFEFF]*[=+@-]/.test(s) || /^[\t\r\n]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }

  function toCSV(records, customDomains) {
    const rows = [["user_id", "username", "name", "profile_url", "bio", "location", "followers_count", "following_count", "created_at", "bio_topics", "observed_at"]];
    for (const r of analyze(records, customDomains).profiles) rows.push([
      r.id, r.handle, r.name, "https://x.com/" + r.handle, r.bio, r.location,
      r.followers, r.following, r.createdAt, r.domains.map((d) => d.name).join("; "), new Date(r.observedAt).toISOString(),
    ]);
    return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
  }

  const api = { requestContext, extractPage, normalizeRecord, mergeRecords, analyze, toCSV };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FollowerLensAudience = api;
})(typeof window !== "undefined" ? window : globalThis);
