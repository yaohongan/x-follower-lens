// Capture only a deliberately selected account's Followers responses.
// Feed recommendations, Following and verified-only lists are never used as audience samples.
(() => {
  const A = window.FollowerLensAudience;
  let dataset = null;
  let enabled = true;
  let ready = false;
  let pending = [];

  function process(data) {
    if (!enabled || !dataset?.active || typeof data.body !== "string" || data.body.length > 4 * 1024 * 1024) return;
    const context = A.requestContext(data.requestUrl, data.pagePath);
    if (!context || context.ownerHandle !== dataset.ownerHandle) return;
    if (!Number.isFinite(data.requestAt) || data.requestAt < dataset.captureAfter) return;
    if (dataset.userId && context.userId !== dataset.userId) return;
    let json;
    try { json = JSON.parse(data.body); } catch (_) { return; }
    const page = A.extractPage(json, context, Date.now());
    if (!page.recognized && !page.errors.length) return;
    chrome.runtime.sendMessage({
      type: "fl-audience", action: "capture", ownerHandle: context.ownerHandle,
      userId: context.userId, requestAt: data.requestAt, records: page.records, warning: page.errors.length > 0,
    }).catch(() => {}); // A disconnected extension context must never break X's page.
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== "follower-lens-audience") return;
    const data = event.data;
    if (typeof data.body !== "string" || data.body.length > 4 * 1024 * 1024) return;
    if (!ready) { if (pending.length < 3) pending.push(data); return; }
    process(data);
  });

  chrome.storage.local.get(["fl_audience", "fl_settings"]).then((saved) => {
    dataset = saved.fl_audience || null;
    enabled = saved.fl_settings?.enabled !== false;
    ready = true;
    const waiting = pending; pending = [];
    for (const data of waiting) process(data);
  }).catch(() => { ready = true; pending = []; });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.fl_audience) dataset = changes.fl_audience.newValue || null;
    if (changes.fl_settings) enabled = changes.fl_settings.newValue?.enabled !== false;
  });
})();
