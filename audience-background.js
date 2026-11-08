// A single writer keeps records from multiple X tabs from overwriting one another.
// This worker does not fetch anything. Only explicitly started browsing samples are saved.
importScripts("parse.js", "audience-core.js");

const A = globalThis.FollowerLensAudience;
const AUDIENCE_KEY = "fl_audience";
const MAX_RECORDS = 5000;
const MAX_REPORT_BYTES = 4 * 1024 * 1024;
const MAX_STORAGE_BYTES = 8 * 1024 * 1024;
let queue = Promise.resolve();

function serial(task) {
  const result = queue.then(task);
  queue = result.catch(() => {});
  return result;
}

function reportPage(sender) {
  if (sender.id !== chrome.runtime.id || !sender.url) return false;
  return sender.url.split(/[?#]/)[0] === chrome.runtime.getURL("audience.html");
}

function browsingOwner(sender) {
  if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || !sender.tab || !sender.url) return null;
  try {
    const url = new URL(sender.url);
    if (url.protocol !== "https:" || !["x.com", "twitter.com"].includes(url.hostname)) return null;
    const match = url.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/followers\/?$/);
    return match ? match[1].toLowerCase() : null;
  } catch (_) { return null; }
}

async function readDataset() {
  return (await chrome.storage.local.get(AUDIENCE_KEY))[AUDIENCE_KEY] || null;
}

async function saveDataset(dataset) {
  const bytes = new TextEncoder().encode(JSON.stringify({ [AUDIENCE_KEY]: dataset })).length;
  const [total, previous] = await Promise.all([
    chrome.storage.local.getBytesInUse(null), chrome.storage.local.getBytesInUse(AUDIENCE_KEY),
  ]);
  if (bytes > MAX_REPORT_BYTES || total - previous + bytes > MAX_STORAGE_BYTES) {
    throw new Error("本地存储接近上限，已暂停。请先导出报告，再清除样本。");
  }
  await chrome.storage.local.set({ [AUDIENCE_KEY]: dataset });
}

async function dispatch(message, sender) {
  const dataset = await readDataset();
  if (message.action === "capture") {
    const owner = browsingOwner(sender);
    const settings = (await chrome.storage.local.get("fl_settings")).fl_settings;
    if (!owner || !dataset || !dataset.active || (settings && settings.enabled === false)) return { ok: true, ignored: true };
    if (owner !== dataset.ownerHandle || message.ownerHandle !== owner || !/^\d+$/.test(message.userId || "")) return { ok: true, ignored: true };
    if (!Number.isFinite(message.requestAt) || message.requestAt < dataset.captureAfter) return { ok: true, ignored: true };
    if (dataset.userId && dataset.userId !== message.userId) return { ok: true, ignored: true };
    if (!Array.isArray(message.records) || message.records.length > 1000) return { ok: false, error: "粉丝响应格式无效。" };

    const merged = A.mergeRecords(dataset.records, message.records, MAX_RECORDS);
    const atLimit = merged.truncated || merged.records.length >= MAX_RECORDS;
    const warning = message.warning === true;
    const next = {
      ...dataset, userId: message.userId, records: merged.records,
      pages: dataset.pages + 1, updatedAt: Date.now(),
      active: !atLimit && !warning,
      status: warning ? "error" : atLimit ? "limit" : "recording",
      error: warning ? "X 返回了错误或无法识别的粉丝数据，记录已暂停；已保存的记录仍可查看。" :
        atLimit ? "已达到 5,000 人样本上限，记录已暂停；可导出当前结果。" : null,
    };
    try { await saveDataset(next); }
    catch (_) {
      // A failed write never replaces the last successfully saved sample.
      const stopped = { ...dataset, active: false, status: "error", error: "保存失败或存储已满，记录已暂停。当前响应未保存，请先导出已有报告。" };
      await chrome.storage.local.set({ [AUDIENCE_KEY]: stopped });
      return { ok: false, error: stopped.error };
    }
    return { ok: true, count: next.records.length };
  }

  if (!reportPage(sender)) return { ok: false, error: "请从粉丝构成报告页操作。" };
  if (message.action === "get") return { ok: true, dataset };
  if (message.action === "clear") {
    await chrome.storage.local.remove(AUDIENCE_KEY);
    return { ok: true, dataset: null };
  }
  if (message.action === "pause") {
    if (!dataset) return { ok: true, dataset: null };
    const next = { ...dataset, active: false, status: "paused" };
    // Stopping must still work when another feature has filled the growth budget.
    await chrome.storage.local.set({ [AUDIENCE_KEY]: next });
    return { ok: true, dataset: next };
  }
  if (message.action === "start") {
    const ownerHandle = String(message.ownerHandle || "").replace(/^@/, "").trim().toLowerCase();
    if (!/^[a-z0-9_]{1,15}$/.test(ownerHandle)) return { ok: false, error: "请输入有效的 X 用户名，例如 example（无需完整网址）。" };
    if (dataset && dataset.ownerHandle !== ownerHandle) return { ok: false, error: "请先导出并清除现有样本，再切换账号。" };
    const settings = (await chrome.storage.local.get("fl_settings")).fl_settings;
    if (settings && settings.enabled === false) return { ok: false, error: "请先在扩展弹窗中开启总开关。" };
    if (dataset?.active) return { ok: true, dataset };
    if (dataset && dataset.records.length >= MAX_RECORDS) return { ok: false, error: "已达到 5,000 人样本上限，请先导出并清除样本。" };
    const next = dataset ? { ...dataset, captureAfter: Date.now(), active: true, status: "recording", error: null } : {
      version: 1, ownerHandle, userId: null, active: true, startedAt: Date.now(),
      captureAfter: Date.now(),
      updatedAt: null, records: [], pages: 0, status: "recording", error: null,
    };
    await saveDataset(next);
    return { ok: true, dataset: next };
  }
  return { ok: false, error: "不支持的操作。" };
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!message || message.type !== "fl-audience") return;
  serial(() => dispatch(message, sender)).then(respond, () => respond({ ok: false, error: "读取或保存本地报告失败，请重试或先导出已有数据。" }));
  return true;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.fl_settings || changes.fl_settings.newValue?.enabled !== false) return;
  serial(async () => {
    const dataset = await readDataset();
    if (dataset?.active) await chrome.storage.local.set({ [AUDIENCE_KEY]: { ...dataset, active: false, status: "paused", error: "插件总开关已关闭，粉丝记录已暂停。" } });
  }).catch(() => {});
});
