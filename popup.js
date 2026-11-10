(() => {
  const KEY = "fl_settings";
  const HIST_KEY = "fl_hist";
  const DOM_KEY = "fl_dom";
  const DEFAULTS = {
    enabled: true, showRatio: false, tierColors: true, hoverCard: true,
    trackHistory: true, dimLowQuality: true, flow: true, flowFx: true, replyMark: true, replyDim: false, fansBar: true, followsBar: true, reviewBtn: true, flowSize: "m", notifyMark: true, notifyLine: 10000, fansLines: "3000,10000,30000,50000,100000", cardBtn: true, avatarFx: true, avatarSpin: false, flowPos: "corner", hideForeign: true, layout: "below", maxTags: 3, debug: false,
    customDomains: "",
    tags: { domain: true, relation: true, bigV: true, farm: true, newAcct: true, oldAcct: true, engaged: true, lowActive: true },
  };
  let settings = null;

  document.getElementById("ver").textContent = "v" + chrome.runtime.getManifest().version;

  const merge = (s) => Object.assign({}, DEFAULTS, s, { tags: Object.assign({}, DEFAULTS.tags, s && s.tags) });
  const save = () => chrome.storage.local.set({ [KEY]: settings });

  function paint() {
    document.querySelectorAll('input[type="checkbox"][data-key]').forEach((el) => { el.checked = !!settings[el.dataset.key]; });
    document.querySelectorAll('input[type="radio"][data-key]').forEach((el) => { el.checked = String(settings[el.dataset.key]) === el.value; });
    document.querySelectorAll("input[data-tag]").forEach((el) => { el.checked = !!settings.tags[el.dataset.tag]; });
    const ta = document.getElementById("customDomains");
    if (document.activeElement !== ta) ta.value = settings.customDomains || "";
    const fl = document.getElementById("fansLines");
    if (document.activeElement !== fl) fl.value = settings.fansLines || "";
    const nl = document.getElementById("notifyLine");
    if (document.activeElement !== nl) nl.value = String(settings.notifyLine || 10000);
    document.getElementById("panel").classList.toggle("off", !settings.enabled);
  }

  function countHist() {
    chrome.storage.local.get(HIST_KEY, (r) => {
      document.getElementById("histCount").textContent = Object.keys(r[HIST_KEY] || {}).length;
    });
  }

  chrome.storage.local.get(KEY, (r) => {
    settings = merge(r[KEY]);
    paint();
    countHist();
  });

  document.addEventListener("change", (e) => {
    const el = e.target;
    if (!settings) return;
    if (el.type === "radio" && el.dataset.key) settings[el.dataset.key] = el.dataset.key === "maxTags" ? Number(el.value) : el.value;
    else if (el.type !== "checkbox") return;
    else if (el.dataset.key) settings[el.dataset.key] = el.checked;
    else if (el.dataset.tag) settings.tags[el.dataset.tag] = el.checked;
    paint();
    save();
  });

  let taTimer = null;
  document.getElementById("fansLines").addEventListener("input", (e) => {
    clearTimeout(taTimer);
    taTimer = setTimeout(() => { if (settings) { settings.fansLines = e.target.value; save(); } }, 400);
  });

  document.getElementById("notifyLine").addEventListener("input", (e) => {
    clearTimeout(taTimer);
    taTimer = setTimeout(() => {
      const m = String(e.target.value).trim().match(/^([\d.]+)\s*(万|w)?$/i);
      const n = m ? Number(m[1]) * (m[2] ? 10000 : 1) : NaN;
      if (settings && n > 0) { settings.notifyLine = Math.round(n); save(); }
    }, 400);
  });

  document.getElementById("customDomains").addEventListener("input", (e) => {
    clearTimeout(taTimer);
    taTimer = setTimeout(() => { if (settings) { settings.customDomains = e.target.value; save(); } }, 400);
  });

  document.getElementById("copyDiag").addEventListener("click", (e) => {
    const btn = e.currentTarget;
    chrome.storage.local.get("fl_diag", (r) => {
      const txt = (r.fl_diag || []).length ? JSON.stringify(r.fl_diag) : "";
      if (!txt) { btn.textContent = "还没有记录"; setTimeout(() => (btn.textContent = "复制诊断"), 1500); return; }
      navigator.clipboard.writeText(txt).then(() => { btn.textContent = "已复制"; setTimeout(() => (btn.textContent = "复制诊断"), 1500); });
    });
  });

  document.getElementById("clearHist").addEventListener("click", () => {
    chrome.storage.local.remove([HIST_KEY, DOM_KEY, "fl_fans", "fl_follows"], countHist);   // 粉丝/关注列表统计也一起清掉
  });
})();
