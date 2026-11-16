(() => {
  const KEY = "fl_settings";
  const HIST_KEY = "fl_hist";
  const DOM_KEY = "fl_dom";
  const DEFAULTS = {
    enabled: true, showRatio: false, tierColors: true, hoverCard: true,
    trackHistory: true, dimLowQuality: true, flow: true, flowFx: true, replyMark: true, replyDim: false, fansBar: true, rewardCard: true, rewardAuto: false, fansAuto: false, fansBtn: true, followsAuto: false, followsBar: true, reviewBtn: true, flowSize: "m", notifyMark: true, notifyLine: 10000, fansLines: "3000,10000,30000,50000,100000", cardBtn: true, avatarFx: true, avatarSpin: false, flowPos: "corner", hideForeign: true, layout: "below", maxTags: 3, debug: false,
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

  // ---- 原创奖励进度 + 粉丝达标预测 ----
  const P = window.FollowerLensParse;
  const fmtK = (n) => n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M" : n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K" : String(Math.round(n));
  const fmtDays = (d) => d <= 0 ? "已达到" : d > 365 ? "超过一年" : d <= 1 ? "约 1 天" : `约 ${d} 天`;
  const dateAfter = (d) => { const t = new Date(Date.now() + d * 86400e3); return `${t.getMonth() + 1}月${t.getDate()}日`; };
  function dailyTable(rows, daily, now) {
    const has = rows.some((x) => x.total !== null || x.counted !== null);
    const stale = !daily || !daily.at || now - daily.at > 3 * 86400e3;
    const link = `<a class="ins-link" href="https://x.com/i/account_analytics" target="_blank" rel="noreferrer">去账号分析页更新每日曝光</a>`;
    if (!has) return `<p class="ins-empty">每日整体曝光和蓝 V 曝光:打开一次「账号分析」页就会记下最近几十天。</p>${link}`;
    const f = (n) => n === null ? "—" : fmtK(n);
    const body = rows.slice().reverse().map((x) => {
      const pct = x.total ? Math.round(x.verified / x.total * 100) + "%" : "";
      return `<tr><td>${Number(x.day.slice(5, 7))}/${Number(x.day.slice(8))}</td><td>${f(x.total)}</td><td>${f(x.verified)}<em>${pct}</em></td><td>${x.counted === null ? "—" : (x.counted >= 0 ? "+" : "") + fmtK(x.counted)}</td></tr>`;
    }).join("");
    return `<table class="dtab"><thead><tr><th>日期</th><th>整体曝光</th><th>蓝 V 曝光</th><th>计入奖励</th></tr></thead><tbody>${body}</tbody></table>${stale ? link : ""}`;
  }
  function renderInsight() {
    const box = document.getElementById("insight");
    chrome.storage.local.get(["fl_reward", "fl_daily", "fl_me", HIST_KEY], (r) => {
      const now = Date.now();
      const rw = P.rewardSummary(r.fl_reward, now);
      let html = "";
      if (!rw) {
        html += `<div class="ins"><div class="ins-h"><b>原创奖励进度</b></div><p class="ins-empty">还没有数据。打开一次「原创内容奖励」页面,插件会把累计曝光记下来(只存在你的浏览器里)。想省掉这一步,在下面的设置里打开「每天自动更新」。</p><a class="ins-link" href="https://x.com/i/jf/creators/original_content_rewards" target="_blank" rel="noreferrer">去原创内容奖励页</a></div>`;
      } else {
        const when = new Date(rw.at); const hh = String(when.getHours()).padStart(2, "0") + ":" + String(when.getMinutes()).padStart(2, "0");
        const sameDay = new Date().toDateString() === when.toDateString();
        let eta = "";
        if (rw.reached) eta = "累计已达到门槛。注意这个数是滚动 90 天的,以后可能掉回去,以 X 页面为准。";
        else if (rw.etaDays !== null) eta = `按近 ${rw.n} 天平均净增 +${fmtK(rw.avg)}/天,${fmtDays(rw.etaDays)}后(${dateAfter(rw.etaDays)})达标。这是估算,旧曝光会不断滚出 90 天窗口。`;
        else if (rw.n >= 3) eta = "近几天净增是 0 或负数(旧曝光滚出得比新增快),按现在的趋势暂时追不上。";
        else eta = `再多记 ${3 - rw.n > 0 ? 3 - rw.n : 1} 天数据,就能估算几天达标(每天打开一次奖励页)。`;
        const max = Math.max(1, ...rw.bars.map((b) => Math.abs(b.diff || 0)));
        const bars = rw.bars.map((b) => `<div class="bar${b.diff === null ? " na" : b.diff < 0 ? " neg" : ""}" style="height:${b.diff === null ? 14 : Math.max(8, Math.round(Math.abs(b.diff) / max * 100))}%" title="${b.day}:${b.diff === null ? "没有记录" : (b.diff >= 0 ? "+" : "") + fmtK(b.diff)}"></div>`).join("");
        const lbs = rw.bars.map((b) => `<span>${Number(b.day.slice(5, 7))}/${Number(b.day.slice(8))}</span>`).join("");
        html += `<div class="ins"><div class="ins-h"><b>原创奖励进度</b><span class="pill">${rw.pct.toFixed(1)}%</span></div>
<div class="ins-big">${fmtK(rw.v)}<small> / ${fmtK(rw.target)}</small></div>
<div class="pbar"><i style="width:${rw.pct}%"></i></div>
<div class="ins-row"><span>${sameDay ? "今天" : (when.getMonth() + 1) + "月" + when.getDate() + "日"} ${hh} 记录${rw.stale ? "(已过期)" : ""}</span><span>${rw.reached ? "已达标" : "还差 " + fmtK(rw.remain)}</span></div>
<p class="ins-eta">${eta}</p>
<div class="bars">${bars}</div><div class="lbs">${lbs}</div>
${dailyTable(P.rewardDaily(r.fl_reward, r.fl_daily, now), r.fl_daily, now)}
<p class="ins-note">「计入奖励」是相邻两天累计数的差(净变化,含到期移出),不是当天新增。奖励累计在你打开奖励页时更新,每日曝光在你打开账号分析页时更新。</p>
<a class="ins-link" href="https://x.com/i/jf/creators/original_content_rewards" target="_blank" rel="noreferrer">去更新</a></div>`;
      }
      const me = r.fl_me, hist = r[HIST_KEY] || {};
      const key = me && Object.keys(hist).find((k) => k.toLowerCase() === me.toLowerCase());
      const fe = key ? P.followerEta(hist[key], now) : null;
      if (key && hist[key].length) {
        const cur = hist[key][hist[key].length - 1][1];
        if (!fe) html += `<div class="ins"><div class="ins-h"><b>粉丝达标预测</b></div><div class="ins-big">${cur.toLocaleString()}<small> 位粉丝 · @${me}</small></div><p class="ins-empty">需要至少相隔一天的两次记录才能预测。每天打开 X 看一眼就会自动记。</p></div>`;
        else {
          const prog = fe.next ? Math.min(100, fe.cur / fe.next * 100) : 100;
          html += `<div class="ins"><div class="ins-h"><b>粉丝达标预测</b></div><div class="ins-big">${fe.cur.toLocaleString()}<small> 位粉丝 · @${me}</small></div>
<div class="pbar"><i style="width:${prog}%"></i></div>
<div class="ins-row"><span>近 ${Math.max(1, Math.round(fe.spanDays))} 天 ${fe.perDay >= 0 ? "+" : ""}${fe.perDay.toFixed(1)}/天</span><span>${fe.next ? "下一档 " + fe.next.toLocaleString() : ""}</span></div>
<p class="ins-eta">${!fe.next ? "" : fe.etaDays !== null ? `按这个速度,${fmtDays(fe.etaDays)}后(${dateAfter(fe.etaDays)})到 ${fe.next.toLocaleString()}。这是估算。` : "近期粉丝没有增长,暂时算不出。"}</p></div>`;
        }
      }
      box.innerHTML = html;
    });
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
    renderInsight();
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

  document.getElementById("copyFlow").addEventListener("click", (e) => {
    const btn = e.currentTarget, old = btn.textContent;
    chrome.storage.local.get(["fl_flowdiag", "fl_reward"], (r) => {
      const txt = (r.fl_flowdiag || []).length ? JSON.stringify({ reward: r.fl_reward, responses: r.fl_flowdiag }) : "";
      if (!txt) { btn.textContent = "还没有记录"; setTimeout(() => (btn.textContent = old), 1500); return; }
      navigator.clipboard.writeText(txt).then(() => { btn.textContent = "已复制"; setTimeout(() => (btn.textContent = old), 1500); });
    });
  });

  document.getElementById("clearHist").addEventListener("click", () => {
    chrome.storage.local.remove([HIST_KEY, DOM_KEY, "fl_fans", "fl_follows", "fl_flowdiag"], () => { countHist(); renderInsight(); });   // 粉丝/关注列表统计也一起清掉
  });
})();
