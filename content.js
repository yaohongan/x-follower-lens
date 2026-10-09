(() => {
  const P = window.FollowerLensParse;
  const SETTINGS_KEY = "fl_settings";
  const HIST_KEY = "fl_hist";
  const HIST_MAX_USERS = 3000;
  const HIST_MAX_POINTS = 40;
  const HIST_MIN_GAP = 6 * 3600e3;

  const users = new Map();      // handle -> user
  const tweetSeen = new Set();  // 去重,避免同一条推文重复累计
  const stats = new Map();      // handle -> { views, interactions }
  let settings = null;          // 读完存储后才渲染
  let settingsVer = 0;
  let hist = {};
  let histDirty = false;
  let msgCount = 0;
  const pending = [];           // 设置读完之前收到的数据包

  // ---------- 设置与历史 ----------
  const storage = (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) || null;

  function init() {
    if (!storage) { settings = P.mergeSettings(); flush(); return; }
    storage.get([SETTINGS_KEY, HIST_KEY], (res) => {
      settings = P.mergeSettings(res && res[SETTINGS_KEY]);
      hist = (res && res[HIST_KEY]) || {};
      applyDebug();
      flush();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes[HIST_KEY] && changes[HIST_KEY].newValue === undefined) hist = {};  // 弹窗里清除了记录
      if (!changes[SETTINGS_KEY]) return;
      settings = P.mergeSettings(changes[SETTINGS_KEY].newValue);
      settingsVer++;
      applyDebug();
      scheduleRender();
    });
  }

  function flush() {
    while (pending.length) handleMessage(pending.shift());
    scheduleRender();
  }

  function recordHistory(u, now) {
    if (!settings.trackHistory) return;
    const arr = hist[u.handle] || (hist[u.handle] = []);
    const last = arr[arr.length - 1];
    if (last && now - last[0] < HIST_MIN_GAP) return;
    arr.push([now, u.followers]);
    if (arr.length > HIST_MAX_POINTS) arr.shift();
    histDirty = true;
  }

  let saveTimer = null;
  function scheduleSave() {
    if (!storage || saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      if (!histDirty) return;
      histDirty = false;
      const handles = Object.keys(hist);
      if (handles.length > HIST_MAX_USERS) {
        handles
          .sort((a, b) => hist[a][hist[a].length - 1][0] - hist[b][hist[b].length - 1][0])
          .slice(0, handles.length - HIST_MAX_USERS)
          .forEach((h) => delete hist[h]);
      }
      try { storage.set({ [HIST_KEY]: hist }); } catch (_) {}
    }, 3000);
  }

  // ---------- 数据包处理 ----------
  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.source !== "follower-lens") return;
    msgCount++;
    if (!settings) { pending.push(e.data.body); return; }
    handleMessage(e.data.body);
    scheduleRender();
  });

  function handleMessage(body) {
    let json;
    try { json = JSON.parse(body); } catch (_) { return; }
    const { users: us, tweets } = P.extract(json);
    const now = Date.now();
    for (const u of us) {
      users.set(u.handle, u);
      recordHistory(u, now);
    }
    for (const t of tweets) {
      if (tweetSeen.has(t.id)) continue;
      tweetSeen.add(t.id);
      const s = stats.get(t.author) || { views: 0, interactions: 0 };
      s.views += t.views;
      s.interactions += t.interactions;
      stats.set(t.author, s);
    }
    if (histDirty) scheduleSave();
  }

  // ---------- 渲染 ----------
  function handleOf(container) {
    for (const a of container.querySelectorAll('a[role="link"][href^="/"]')) {
      const m = a.getAttribute("href").match(/^\/([A-Za-z0-9_]{1,15})$/);
      if (m && a.textContent.trim().startsWith("@")) return m[1].toLowerCase();
    }
    return null;
  }

  function buildBadge(handle, compact) {
    const u = users.get(handle);
    if (!u) return null;
    const stat = stats.get(handle);
    const list = P.tags(u, stat, Date.now(), settings);

    const wrap = document.createElement("span");
    wrap.className = "fl-badge";
    wrap.dataset.flHandle = handle;

    const main = document.createElement("span");
    main.className = "fl-main" + (settings.tierColors ? " t" + P.tier(u.followers) : "");
    main.textContent = `${P.fmt(u.followers)} 粉丝`;
    wrap.append(main);

    if (settings.showRatio && u.following > 0) {
      const r = document.createElement("span");
      r.className = "fl-ratio";
      r.textContent = `比 ${P.fmtRatio(P.ratioOf(u))}`;
      wrap.append(r);
    }

    if (!compact) {
      for (const t of list.slice(0, settings.maxTags)) {
        const el = document.createElement("span");
        el.className = "fl-tag " + t.cls;
        el.textContent = t.text;
        wrap.append(el);
      }
    }
    return { wrap, list };
  }

  function sigOf(handle, compact) {
    const u = users.get(handle), s = stats.get(handle);
    return [u.followers, s ? s.views : 0, u.followedBy, u.iFollow, settingsVer, compact ? 1 : 0].join("|");
  }

  // ----- 推文头部:行内 / 单独一行 / 自动 -----
  const placed = new WeakMap();   // User-Name 元素 -> { badge, line, sig }

  // 头部整行(名字区 + 其它插件的小标 + 菜单)。结构不符就返回 null,调用方退回行内。
  function headerRow(un) {
    const row = un.parentElement && un.parentElement.parentElement && un.parentElement.parentElement.parentElement;
    const host = row && row.parentElement;
    if (!row || !host) return null;
    const rs = getComputedStyle(row), hs = getComputedStyle(host);
    return rs.display === "flex" && rs.flexDirection === "row" && hs.flexDirection === "column" ? row : null;
  }

  // 名字或 @ID 因为空间不够被省略(...)了吗
  function crowded(un, badge) {
    for (const n of un.querySelectorAll("*")) {
      if (n === badge || badge.contains(n)) continue;
      if (n.clientWidth > 0 && n.scrollWidth > n.clientWidth + 1) return true;
    }
    return false;
  }

  function placeBelow(un, badge) {
    const row = headerRow(un);
    if (!row) return null;
    const line = document.createElement("div");
    line.className = "fl-line";
    line.append(badge);
    row.after(line);
    return line;
  }

  function decorateTweet(un) {
    const handle = handleOf(un);
    if (!handle || !users.has(handle)) return;
    const sig = sigOf(handle, false);
    const rec = placed.get(un);
    if (rec && rec.badge.isConnected && rec.sig === sig) return;
    if (rec) { rec.badge.remove(); if (rec.line) rec.line.remove(); }

    const built = buildBadge(handle, false);
    if (!built) return;
    let line = null;
    if (settings.layout === "below") {
      line = placeBelow(un, built.wrap);
      if (!line) un.append(built.wrap);
    } else {
      un.append(built.wrap);
      // 自动:放进去之后名字被挤省略了,就挪到下一行(只判断这一次,不来回挪)
      if (settings.layout === "auto" && crowded(un, built.wrap)) line = placeBelow(un, built.wrap);
    }
    placed.set(un, { badge: built.wrap, line, sig });
  }

  // ----- 关注 / 粉丝列表里的用户行 -----
  function decorateCell(cell, anchor) {
    const handle = handleOf(cell);
    if (!handle || !users.has(handle)) return;
    const compact = !!cell.closest('[data-testid="sidebarColumn"]');
    const sig = sigOf(handle, compact);
    const old = cell.querySelector(".fl-badge");
    if (old && old.dataset.flHandle === handle && old.dataset.flSig === sig) return;
    if (old) old.remove();
    const built = buildBadge(handle, compact);
    if (!built) return;
    built.wrap.dataset.flSig = sig;
    if (anchor) anchor.append(built.wrap);
    cell.classList.toggle("fl-dim", settings.dimLowQuality && P.shouldDim(built.list));
  }

  function cleanup() {
    document.querySelectorAll(".fl-line").forEach((l) => l.remove());
    document.querySelectorAll(".fl-badge").forEach((b) => b.remove());
    document.querySelectorAll(".fl-dim").forEach((c) => c.classList.remove("fl-dim"));
  }

  function render() {
    if (!settings) return;
    if (!settings.enabled) { cleanup(); return; }
    document.querySelectorAll('article[data-testid="tweet"] [data-testid="User-Name"]').forEach(decorateTweet);
    document.querySelectorAll('[data-testid="UserCell"]').forEach((cell) => {
      const nameBlock = cell.querySelector('[dir="ltr"]')?.closest("div");
      decorateCell(cell, nameBlock && nameBlock.parentElement);
    });
    updateHud();
  }

  let timer = null;
  function scheduleRender() {
    if (timer) return;
    timer = setTimeout(() => { timer = null; render(); }, 150);
  }

  new MutationObserver(scheduleRender).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  // ---------- 调试条 ----------
  let hud = null;
  function applyDebug() {
    if (settings.debug && !hud) {
      hud = document.createElement("div");
      hud.id = "fl-hud";
      document.documentElement.append(hud);
    } else if (!settings.debug && hud) {
      hud.remove();
      hud = null;
    }
    updateHud();
  }
  function updateHud() {
    if (!hud) return;
    const shown = document.querySelectorAll(".fl-badge").length;
    const text = `FL 数据包:${msgCount} 用户:${users.size} 已显示:${shown}`;
    if (hud.textContent !== text) hud.textContent = text;
  }

  // ---------- 悬停详情卡 ----------
  let tip = null;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function accountAge(createdAt, now) {
    const d = new Date(createdAt);
    if (isNaN(d)) return "";
    const months = Math.floor((now - d.getTime()) / (30.44 * 86400e3));
    const y = Math.floor(months / 12), m = months % 12;
    const span = y > 0 ? `${y} 年${m ? ` ${m} 个月` : ""}` : `${m} 个月`;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")} · ${span}`;
  }

  function tipHtml(handle) {
    const u = users.get(handle);
    if (!u) return "";
    const now = Date.now();
    const stat = stats.get(handle);
    const er = P.engagementOf(stat);
    const rows = [];
    rows.push(["粉丝", u.followers.toLocaleString()]);
    rows.push(["关注", u.following.toLocaleString()]);
    rows.push(["粉丝/关注比", P.fmtRatio(P.ratioOf(u))]);
    if (u.tweets !== null && u.tweets !== undefined) rows.push(["推文数", Number(u.tweets).toLocaleString()]);
    if (u.createdAt) rows.push(["注册", accountAge(u.createdAt, now)]);
    rows.push(["互动率", er === null ? `<span class="dim">样本不足(需浏览量合计 ≥ 2000)</span>` : `${(er * 100).toFixed(2)}%`]);
    if (settings.trackHistory) {
      const d = P.deltaFrom(hist[handle], u.followers, now);
      if (d) {
        const sign = d.diff > 0 ? "+" : d.diff < 0 ? "" : "±";
        const cls = d.diff > 0 ? "up" : d.diff < 0 ? "down" : "";
        const pct = d.base > 0 ? ` (${sign}${((d.diff / d.base) * 100).toFixed(1)}%)` : "";
        rows.push([`近 ${d.days} 天`, `<span class="${cls}">${sign}${d.diff.toLocaleString()}${pct}</span>`]);
      } else {
        rows.push(["变化", `<span class="dim">已开始记录,明天起显示</span>`]);
      }
    }
    const rel = u.followedBy && u.iFollow ? "互相关注" : u.followedBy ? "TA 关注了你" : u.iFollow ? "你关注了 TA" : "";
    if (rel) rows.push(["关系", rel]);
    return `<div class="fl-tip-h">@${esc(handle)}</div>` +
      rows.map(([k, v]) => `<div class="fl-tip-r"><span>${k}</span><b>${v}</b></div>`).join("");
  }

  function showTip(badge) {
    if (!settings || !settings.hoverCard) return;
    const handle = badge.dataset.flHandle;
    if (!tip) {
      tip = document.createElement("div");
      tip.id = "fl-tip";
      document.documentElement.append(tip);
    }
    tip.innerHTML = tipHtml(handle);
    const m = getComputedStyle(document.body).backgroundColor.match(/\d+/g) || [255, 255, 255];
    tip.dataset.theme = (+m[0] * 299 + +m[1] * 587 + +m[2] * 114) / 1000 < 128 ? "dark" : "light";
    tip.style.display = "block";
    const r = badge.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = Math.min(Math.max(8, r.left), window.innerWidth - tw - 8);
    let top = r.bottom + 6;
    if (top + th > window.innerHeight - 8) top = Math.max(8, r.top - th - 6);
    tip.style.left = left + "px";
    tip.style.top = top + "px";
  }
  function hideTip() { if (tip) tip.style.display = "none"; }

  document.addEventListener("mouseover", (e) => {
    const b = e.target.closest && e.target.closest(".fl-badge");
    if (b) showTip(b);
  });
  document.addEventListener("mouseout", (e) => {
    const b = e.target.closest && e.target.closest(".fl-badge");
    if (b && !(e.relatedTarget && b.contains(e.relatedTarget))) hideTip();
  });
  window.addEventListener("scroll", hideTip, { passive: true });

  init();
})();
