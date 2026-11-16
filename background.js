// 每天自动更新「原创奖励累计」和「账号分析每日曝光」:
// 插件自己不发任何请求。做法是在后台悄悄打开 X 的这两个页面(不抢焦点),让 X 页面自己加载数据,
// 内容脚本读完(和你手动打开时读的是同一份)就通知这里,马上把标签页关掉。每个页面最多等 30 秒。
// 触发:你打开 x.com 的任何页面时,内容脚本发现"今天的数据还没记"才会来叫这里,并且受频率限制(每天最多 4 次、两次至少隔 30 分钟)。
const URLS = {
  reward: "https://x.com/i/jf/creators/original_content_rewards?fl_auto=1",
  daily: "https://x.com/i/account_analytics?fl_auto=1",
};
const WAIT_MS = 30000, MIN_GAP = 30 * 60e3, MAX_TRIES = 4;
const tabs = new Map();          // tabId -> { kind, done, timer }
let running = false;

function finish(id) {
  const s = tabs.get(id);
  if (!s) return;
  clearTimeout(s.timer);
  tabs.delete(id);
  chrome.tabs.remove(id, () => void chrome.runtime.lastError);
  s.done();
}

function openAndWait(kind) {
  return new Promise((done) => {
    chrome.tabs.create({ url: URLS[kind], active: false }, (tab) => {
      if (chrome.runtime.lastError || !tab) { done(); return; }
      tabs.set(tab.id, { kind, done, timer: setTimeout(() => finish(tab.id), WAIT_MS) });
    });
  });
}

async function run(need) {
  if (running) return;
  running = true;
  try { for (const kind of need) if (URLS[kind]) await openAndWait(kind); }
  finally { running = false; }
}

chrome.runtime.onMessage.addListener((m, sender) => {
  if (!m || !sender.tab) return;
  if (m.type === "fl-captured") {                       // 内容脚本已经把数据存好了
    for (const [id, s] of tabs) if (id === sender.tab.id && s.kind === m.kind) setTimeout(() => finish(id), 800);
    return;
  }
  if (m.type === "fl-auto" && Array.isArray(m.need) && m.need.length) {
    chrome.storage.local.get(["fl_auto", "fl_settings"], (o) => {
      if (!o.fl_settings || o.fl_settings.rewardAuto !== true || o.fl_settings.rewardCard === false || o.fl_settings.enabled === false) return;
      const day = new Date().toISOString().slice(0, 10), a = o.fl_auto && o.fl_auto.day === day ? o.fl_auto : { day, tries: 0, last: 0 };
      if (running || a.tries >= MAX_TRIES || Date.now() - a.last < MIN_GAP) return;
      a.tries++; a.last = Date.now();
      chrome.storage.local.set({ fl_auto: a }, () => run(m.need.filter((k) => k === "reward" || k === "daily")));
    });
  }
});

chrome.tabs.onRemoved.addListener((id) => { if (tabs.has(id)) finish(id); });
