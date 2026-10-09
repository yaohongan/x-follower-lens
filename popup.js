(() => {
  const KEY = "fl_settings";
  const HIST_KEY = "fl_hist";
  const DEFAULTS = {
    enabled: true, showRatio: false, tierColors: true, hoverCard: true,
    trackHistory: true, dimLowQuality: true, debug: false,
    tags: { relation: true, bigV: true, farm: true, newAcct: true, oldAcct: true, engaged: true, lowActive: true },
  };
  let settings = null;

  document.getElementById("ver").textContent = "v" + chrome.runtime.getManifest().version;

  const merge = (s) => Object.assign({}, DEFAULTS, s, { tags: Object.assign({}, DEFAULTS.tags, s && s.tags) });
  const save = () => chrome.storage.local.set({ [KEY]: settings });

  function paint() {
    document.querySelectorAll("input[data-key]").forEach((el) => { el.checked = !!settings[el.dataset.key]; });
    document.querySelectorAll("input[data-tag]").forEach((el) => { el.checked = !!settings.tags[el.dataset.tag]; });
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
    if (!settings || el.type !== "checkbox") return;
    if (el.dataset.key) settings[el.dataset.key] = el.checked;
    else if (el.dataset.tag) settings.tags[el.dataset.tag] = el.checked;
    paint();
    save();
  });

  document.getElementById("clearHist").addEventListener("click", () => {
    chrome.storage.local.remove(HIST_KEY, countHist);
  });
})();
