(() => {
  const P = window.FollowerLensParse;
  const SETTINGS_KEY = "fl_settings";
  const HIST_KEY = "fl_hist";
  const DOM_KEY = "fl_dom";
  const FANS_KEY = "fl_fans";
  const FANS_MAX_ROWS = 20000, FANS_MAX_OWNERS = 3;
  const FOLLOWS_KEY = "fl_follows";
  const FOLLOWS_MAX_ROWS = 10000, FOLLOWS_MAX_OWNERS = 3;
  const HIST_MAX_USERS = 3000;
  const HIST_MAX_POINTS = 24;
  const HIST_MIN_GAP = 6 * 3600e3;

  // 自我计时:插件自己累计占用了多少主线程时间(毫秒),写到 <html data-fl-perf>,方便排查"是不是插件拖慢了页面"
  const perf = { packets: 0, bytes: 0, handleMs: 0, renderMs: 0, renders: 0, mutMs: 0, mutCalls: 0, since: Date.now() };
  let perfShown = "";
  setInterval(() => {
    const s = JSON.stringify({ ...perf, handleMs: Math.round(perf.handleMs), renderMs: Math.round(perf.renderMs), mutMs: Math.round(perf.mutMs), totalMs: Math.round(perf.handleMs + perf.renderMs + perf.mutMs) });
    if (s !== perfShown) { perfShown = s; document.documentElement.dataset.flPerf = s; }
  }, 2000);

  const users = new Map();      // handle -> user
  const tweetSeen = new Set();  // 去重,避免同一条推文重复累计
  const stats = new Map();      // handle -> { views, interactions }
  // 粉丝构成:owner(正在看的是谁的粉丝列表) -> { ts, rows: Map(handle -> [粉丝数, 关注数, 注册时间ms, 记录时间ms]) }
  // 只存这几个数字,不存简介和头像;只在本地,不上传
  const fans = new Map();
  let fansDirty = false;
  // 关注列表分析:owner(正在看的是谁的"正在关注"列表) -> { ts, rows: Map(handle -> [粉丝数, 关注数, 注册时间ms, 记录时间ms, 对方是否关注你(1/0)]) }
  const follows = new Map();
  let followsDirty = false;
  const authorTweets = new Map();  // 作者 -> Map(推文 id -> { id, views, createdAt, inter, text }),算"TA 平时的水平"和推文复盘用
  const tweetInfo = new Map();  // 推文 id -> { views, createdAt, author }(浏览量取最新一次)
  let settings = null;          // 读完存储后才渲染
  let settingsVer = 0;
  let hist = {};
  const domScores = new Map();   // handle -> { n: 命中总数, ts: 最后更新时间, s: { 方向key: 命中的推文条数 } }
  let domDirty = false;
  let histDirty = false;
  let msgCount = 0;
  const pending = [];           // 设置读完之前收到的数据包

  // ---------- 设置与历史 ----------
  const storage = (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) || null;

  function init() {
    if (!storage) { settings = P.mergeSettings(); flush(); return; }
    storage.get([SETTINGS_KEY, HIST_KEY, DOM_KEY, FANS_KEY, FOLLOWS_KEY], (res) => {
      settings = P.mergeSettings(res && res[SETTINGS_KEY]);
      hist = (res && res[HIST_KEY]) || {};
      const saved = (res && res[DOM_KEY]) || {};
      for (const h in saved) domScores.set(h, { ts: saved[h][0], s: saved[h][1], n: Object.values(saved[h][1]).reduce((a, b) => a + b, 0) });
      const sf = (res && res[FANS_KEY]) || {};
      for (const o in sf) fans.set(o, { ts: sf[o].ts || 0, rows: new Map(Object.entries(sf[o].rows || {})) });
      const sg = (res && res[FOLLOWS_KEY]) || {};
      for (const o in sg) follows.set(o, { ts: sg[o].ts || 0, rows: new Map(Object.entries(sg[o].rows || {})) });
      applyDebug(); applyHtml();
      flush();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes[HIST_KEY] && changes[HIST_KEY].newValue === undefined) hist = {};  // 弹窗里清除了记录
      if (changes[DOM_KEY] && changes[DOM_KEY].newValue === undefined) { domScores.clear(); scheduleRender(); }
      if (changes[FANS_KEY] && changes[FANS_KEY].newValue === undefined) { fans.clear(); scheduleRender(); }
      if (changes[FOLLOWS_KEY] && changes[FOLLOWS_KEY].newValue === undefined) { follows.clear(); scheduleRender(); }
      if (!changes[SETTINGS_KEY]) return;
      settings = P.mergeSettings(changes[SETTINGS_KEY].newValue);
      settingsVer++;
      applyDebug(); applyHtml();
      scheduleRender();
    });
  }

  // 把"隐藏别的插件的流速标"落到 <html> 的类上,由样式表生效(只在这条推文有我们的流速标时才隐藏)
  function applyHtml() {
    document.documentElement.classList.toggle("fl-hide-foreign", !!(settings && settings.enabled && settings.flow && settings.hideForeign));
    for (const s of ["l", "xl"]) document.documentElement.classList.toggle("fl-size-" + s, !!(settings && settings.flowSize === s));   // 流速标大小
  }

  function flush() {
    while (pending.length) queue.push(pending.shift());
    if (queue.length && !draining) { draining = true; setTimeout(drain, 0); }
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
  function doSave() {
    saveTimer = null;
    const out = {};
    if (histDirty) {
      histDirty = false;
      const handles = Object.keys(hist);
      if (handles.length > HIST_MAX_USERS) {
        handles
          .sort((a, b) => hist[a][hist[a].length - 1][0] - hist[b][hist[b].length - 1][0])
          .slice(0, handles.length - HIST_MAX_USERS)
          .forEach((h) => delete hist[h]);
      }
      out[HIST_KEY] = hist;
    }
    if (domDirty) {
      domDirty = false;
      const rows = [...domScores.entries()].sort((a, b) => b[1].ts - a[1].ts).slice(0, HIST_MAX_USERS);
      const obj = {};
      for (const [h, v] of rows) obj[h] = [v.ts, v.s];
      out[DOM_KEY] = obj;
    }
    if (fansDirty) {
      fansDirty = false;
      const owners = [...fans.entries()].sort((a, b) => b[1].ts - a[1].ts).slice(0, FANS_MAX_OWNERS);
      const obj = {};
      for (const [o, v] of owners) obj[o] = { ts: v.ts, rows: Object.fromEntries(v.rows) };
      out[FANS_KEY] = obj;
    }
    if (followsDirty) {
      followsDirty = false;
      const owners = [...follows.entries()].sort((a, b) => b[1].ts - a[1].ts).slice(0, FOLLOWS_MAX_OWNERS);
      const obj = {};
      for (const [o, v] of owners) obj[o] = { ts: v.ts, rows: Object.fromEntries(v.rows) };
      out[FOLLOWS_KEY] = obj;
    }
    // 每个键单独存:chrome.storage 有总量上限(约 10MB),一个键存不进去不能连累其它键(比如历史记录)
    if (storage) for (const k of Object.keys(out)) { try { storage.set({ [k]: out[k] }, () => void chrome.runtime.lastError); } catch (_) {} }
  }
  // 平时 20 秒才存一次(整份历史序列化不小,滚动时别频繁存);页面切到后台或关闭时立刻存,不丢数据
  function scheduleSave() {
    if (!storage || saveTimer) return;
    saveTimer = setTimeout(doSave, 20000);
  }
  function flushSave() {
    if (saveTimer) { clearTimeout(saveTimer); doSave(); }
  }
  document.addEventListener("visibilitychange", () => { if (document.hidden) flushSave(); });
  window.addEventListener("pagehide", flushSave);

  // ---------- 数据包处理 ----------
  // 数据包排队,分片处理:每次最多占 12ms 就让出主线程(不卡页面),但不等"空闲"
  // (空闲回调在页面刚打开最忙的时候会被饿很久,标就出来得慢)
  const queue = [];
  let draining = false;
  function drain() {
    const t0 = performance.now();
    do { const q = queue.shift(); handleMessage(q.body, q.op); } while (queue.length && performance.now() - t0 < 12);
    scheduleRender();
    if (queue.length) setTimeout(drain, 0); else draining = false;
  }
  function enqueue(body, op) {
    // 总开关关着:数据包直接丢掉,不解析、不记录历史、不排队。这样关掉总开关就能干净地对比"有没有这个插件"
    if (!settings.enabled) return;
    queue.push({ body, op });
    if (!draining) { draining = true; setTimeout(drain, 0); }
  }

  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.source !== "follower-lens") return;
    msgCount++;
    if (!settings) { pending.push({ body: e.data.body, op: e.data.op }); return; }
    enqueue(e.data.body, e.data.op);
  });

  function handleMessage(body, op) {
    const t0 = performance.now();
    perf.packets++; perf.bytes += body.length;
    try { handleMessageInner(body, op); } finally { perf.handleMs += performance.now() - t0; }
  }

  function handleMessageInner(body, op) {
    let json;
    try { json = JSON.parse(body); } catch (_) { return; }
    const { users: us, tweets } = P.extract(json);
    const now = Date.now();
    if (op && /^(BlueVerified)?Followers$/.test(op)) captureFans(us, now);
    else if (op === "Following") captureFollows(us, now);
    else if (op === "NotificationsTimeline") captureNotifs(json);
    for (const u of us) {
      users.set(u.handle, u);
      recordHistory(u, now);
    }
    for (const t of tweets) {
      // 记录观察历史(浏览量变了才追加),最多留 8 条,用来算趋势
      const prevInfo = tweetInfo.get(t.id);
      const obs = prevInfo ? prevInfo.obs : [];
      if (!obs.length || obs[obs.length - 1].views !== t.views) {
        obs.push({ views: t.views, at: Date.now() });
        if (obs.length > 8) obs.shift();
      }
      tweetInfo.set(t.id, { views: t.views, createdAt: t.createdAt, author: t.author, obs });
      let ai = authorTweets.get(t.author);
      if (!ai) authorTweets.set(t.author, (ai = new Map()));
      ai.set(t.id, { id: t.id, views: t.views, createdAt: t.createdAt, inter: t.interactions, text: t.text ? t.text.replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim().slice(0, 48) : "" });
      if (tweetSeen.has(t.id)) continue;
      tweetSeen.add(t.id);
      if (t.text && settings.tags.domain) {
        const keys = P.tweetDomains(t.text, settings.customDomains);
        if (keys.length) {
          const d = domScores.get(t.author) || { n: 0, ts: 0, s: {} };
          for (const k of keys) d.s[k] = (d.s[k] || 0) + 1;
          d.n += keys.length; d.ts = Date.now();
          domScores.set(t.author, d); domDirty = true;
        }
      }
      const s = stats.get(t.author) || { views: 0, interactions: 0 };
      s.views += t.views;
      s.interactions += t.interactions;
      stats.set(t.author, s);
    }
    if (histDirty || domDirty) scheduleSave();
    pruneMemory();
  }

  // 刷一整天 X 也不能让内存一直涨:各个表超过上限就丢最老的(Map 按插入顺序)
  function pruneMemory() {
    const cap = (m, max, keep) => { if (m.size > max) { let n = m.size - keep; for (const k of m.keys()) { if (n-- <= 0) break; m.delete(k); } } };
    cap(tweetInfo, 30000, 20000);
    cap(users, 30000, 20000);
    cap(stats, 30000, 20000);
    if (tweetSeen.size > 60000) tweetSeen.clear();
    cap(authorTweets, 5000, 4000);
    for (const ai of authorTweets.values()) cap(ai, 600, 400);
  }

  // ---------- 粉丝构成:边看粉丝列表边记 ----------
  const FANS_PATH = /^\/([A-Za-z0-9_]{1,15})\/(?:followers|verified_followers)\/?$/i;
  function fansOwner() { const m = location.pathname.match(FANS_PATH); return m ? m[1].toLowerCase() : null; }
  function captureFans(us, now) {
    const owner = fansOwner();
    if (!owner || !settings.fansBar) return;
    let rec = fans.get(owner);
    if (!rec) fans.set(owner, (rec = { ts: now, rows: new Map() }));
    for (const u of us) {
      if (u.handle === owner) continue;
      rec.rows.set(u.handle, [u.followers, u.following, u.createdAt ? new Date(u.createdAt).getTime() || 0 : 0, now]);
    }
    if (rec.rows.size > FANS_MAX_ROWS) {
      [...rec.rows.entries()].sort((a, b) => a[1][3] - b[1][3]).slice(0, rec.rows.size - FANS_MAX_ROWS).forEach(([h]) => rec.rows.delete(h));
    }
    rec.ts = now; fansDirty = true;
    scheduleSave();
  }

  // ---------- 新粉丝提醒:通知页里"谁关注了你" ----------
  // 通知接口里每条通知带 notification_icon:person_icon = 有人关注了你(heart_icon 是点赞,retweet_icon 是转发)。
  // 这里只记"关注了你的人"的用户名;粉丝数、标签用已有的用户数据(同一个接口响应里本来就带着)
  const newFollowers = new Set();
  const PERSON_SIG = "M17.863 13.44";   // 通知里"关注"图标(小人)的路径开头
  function captureNotifs(json) {
    const stack = [json];
    while (stack.length) {
      const o = stack.pop();
      if (!o || typeof o !== "object") continue;
      if (o.notification_icon === "person_icon" && o.template && Array.isArray(o.template.from_users)) {
        for (const fu of o.template.from_users) {
          const r = fu && fu.user_results && fu.user_results.result;
          const h = r && ((r.core && r.core.screen_name) || (r.legacy && r.legacy.screen_name));
          if (h) newFollowers.add(String(h).toLowerCase());
        }
        continue;
      }
      for (const k in o) { const v = o[k]; if (v && typeof v === "object") stack.push(v); }
    }
  }
  function markNotifs() {
    const on = settings.notifyMark && settings.enabled && /^\/notifications/.test(location.pathname);
    const line = Number(settings.notifyLine) > 0 ? Number(settings.notifyLine) : 10000;
    const nodes = [...document.querySelectorAll('article[data-testid="notification"]')];
    // 同一个人先关注了你、又点了赞,那条点赞通知里也有他:用通知左边的图标区分(关注 = 小人图标,不依赖界面语言)。
    // X 哪天换了图标,页面上一个"小人图标"都找不到时,退回只按用户名匹配
    const sigOf = (a) => { const p = a.querySelector("svg path"); const d = p && p.getAttribute("d"); return d ? d.slice(0, PERSON_SIG.length) : ""; };
    const anyPerson = nodes.some((a) => sigOf(a) === PERSON_SIG);
    for (const a of nodes) {
      let matched = [];
      if (on && newFollowers.size && (sigOf(a) === PERSON_SIG || !anyPerson)) {
        const seen = new Set();
        for (const l of a.querySelectorAll('a[href^="/"]')) {
          const m = l.getAttribute("href").match(/^\/([A-Za-z0-9_]{1,15})$/);
          const h = m && m[1].toLowerCase();
          if (h && !seen.has(h) && newFollowers.has(h) && users.has(h)) { seen.add(h); matched.push(h); }
        }
        matched.sort((x, y) => users.get(y).followers - users.get(x).followers);
      }
      const sig = matched.length ? matched.map((h) => h + ":" + users.get(h).followers).join(",") + "|" + line + "|" + settingsVer : "";
      const next = a.nextElementSibling, old = next && next.classList && next.classList.contains("fl-notif-row") ? next : null;   // 放在通知(article)下面一行,不去动 X 自己的版式
      if (!matched.length) { if (old) old.remove(); a.classList.remove("fl-notif-vip"); delete a.dataset.flN; continue; }
      if (old && a.dataset.flN === sig) continue;
      if (old) old.remove();
      const row = document.createElement("div"); row.className = "fl-notif-row";
      let vip = false;
      for (const h of matched.slice(0, 3)) {
        const u = users.get(h), big = u.followers >= line;
        vip = vip || big;
        const item = document.createElement("span"); item.className = "fl-notif-item" + (big ? " big" : "");
        const name = document.createElement("b"); name.textContent = (big ? "⭐ " : "") + "@" + h;
        item.append(name);
        const built = buildBadge(h, false);
        if (built) item.append(built.wrap);
        row.append(item);
      }
      if (matched.length > 3) { const more = document.createElement("span"); more.className = "fl-notif-more"; more.textContent = `…还有 ${matched.length - 3} 位`; row.append(more); }
      row.classList.toggle("vip", vip);
      a.insertAdjacentElement("afterend", row);
      a.classList.toggle("fl-notif-vip", vip);
      a.dataset.flN = sig;
    }
  }

  // ---------- 关注列表分析:边看"正在关注"列表边记 ----------
  const FOLLOWS_PATH = /^\/([A-Za-z0-9_]{1,15})\/following\/?$/i;
  function followsOwner() { const m = location.pathname.match(FOLLOWS_PATH); return m ? m[1].toLowerCase() : null; }
  function captureFollows(us, now) {
    const owner = followsOwner();
    if (!owner || !settings.followsBar) return;
    let rec = follows.get(owner);
    if (!rec) follows.set(owner, (rec = { ts: now, rows: new Map() }));
    for (const u of us) {
      if (u.handle === owner) continue;
      rec.rows.set(u.handle, [u.followers, u.following, u.createdAt ? new Date(u.createdAt).getTime() || 0 : 0, now, u.followedBy ? 1 : 0]);
    }
    if (rec.rows.size > FOLLOWS_MAX_ROWS) {
      [...rec.rows.entries()].sort((a, b) => a[1][3] - b[1][3]).slice(0, rec.rows.size - FOLLOWS_MAX_ROWS).forEach(([h]) => rec.rows.delete(h));
    }
    rec.ts = now; followsDirty = true;
    scheduleSave();
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
    const doms = settings.tags.domain ? P.pickDomains(u.bio, (domScores.get(handle) || {}).s, settings.customDomains) : [];
    const list = P.tags(u, stat, Date.now(), settings, { domain: doms[0] || null });

    const wrap = document.createElement("span");
    wrap.className = "fl-badge";
    wrap.dataset.flHandle = handle;
    // 徽标在名字链接里时,鼠标移上来不应触发 X 自己的资料悬浮卡:
    // 不让这些事件冒泡给 X(它靠这几个事件判断悬停),我们自己的详情卡直接监听徽标。
    for (const ev of ["mouseover", "mouseout", "pointerover", "pointerout", "mousemove", "pointermove"]) {
      wrap.addEventListener(ev, (e) => e.stopPropagation());
    }
    wrap.addEventListener("mouseenter", () => showTip(wrap));
    wrap.addEventListener("mouseleave", hideTip);

    const main = document.createElement("span");
    main.className = "fl-main" + (settings.tierColors ? " t" + P.tier(u.followers) : "");
    main.textContent = `${P.fmt(u.followers)} 粉丝`;
    wrap.append(main);
    const risk = P.statusOf(u).risk;
    if (risk >= 1) { const dot = document.createElement("span"); dot.className = "fl-dot r" + risk; dot.setAttribute("aria-hidden", "true"); wrap.append(dot); }

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
        if (t.dom) {
          el.dataset.dom = t.dom;
          // 自定义方向没有预设颜色:按名字算一个固定的色相(同一个名字永远同一个颜色)
          if (t.dom.startsWith("custom")) {
            let h = 0;
            for (const ch of t.text) h = (h * 31 + ch.charCodeAt(0)) % 360;
            el.style.background = `hsl(${h}, 62%, 40%)`;
            el.style.color = "#fff";
          }
        }
        wrap.append(el);
      }
    }
    return { wrap, list };
  }

  function sigOf(handle, compact) {
    const u = users.get(handle), s = stats.get(handle);
    const d = domScores.get(handle);
    const st = u.st;
    return [u.followers, s ? s.views : 0, u.followedBy, u.iFollow, settingsVer, compact ? 1 : 0, d ? d.n : 0, st ? [st.inter, st.wh ? 1 : 0, st.sens ? 1 : 0, st.blockedBy ? 1 : 0].join("") : ""].join("|");
  }

  // ----- 推文头部:行内 / 单独一行 / 自动 -----
  const placed = new WeakMap();   // User-Name 元素 -> { badge, line, sig }
  const flowTier = new WeakMap(); // article -> 这条推文的流速档位(-1 = 没有),给头像装饰用

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
      const art = un.closest("article");
      const corner = art && art.querySelector(".fl-flow-c");
      const hitsCorner = corner && built.wrap.getBoundingClientRect().right > corner.getBoundingClientRect().left && built.wrap.getBoundingClientRect().left < corner.getBoundingClientRect().right;
      if (settings.layout === "auto" && (crowded(un, built.wrap) || hitsCorner)) line = placeBelow(un, built.wrap);
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

  // ----- 推文流速:放在底部操作栏"浏览量"那一格的空位里,不占挤满的头部 -----
  function tweetIdOf(article) {
    for (const a of article.querySelectorAll('a[href*="/status/"]')) {
      const m = a.getAttribute("href").match(/\/status\/(\d+)/);
      if (m && tweetInfo.has(m[1])) return m[1];
    }
    return null;
  }

  // 别的插件的流速标。SoPilot 在时间线上是挂在 article 下的绝对定位浮层,在推文详情页上却是 position: static、
  // 直接嵌在标题行里,所以不能靠"绝对定位 + article 直接子元素"来找,要按它自己的标识找,不管它在哪。
  const FOREIGN_SEL = '[class*="sopilot-x-velocity-host"], [class*="xvm-badge"]';
  function findForeignChip(article) {
    const ar = article.getBoundingClientRect();
    for (const el of article.querySelectorAll(FOREIGN_SEL)) {
      if (isOurs(el)) continue;
      const r = el.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) continue;                                 // display:none 的(没数据的推文)不算
      if (r.right <= ar.left || r.left >= ar.right || r.bottom <= ar.top || r.top >= ar.bottom) continue;   // 得真的落在这条推文范围内
      return el;
    }
    return null;
  }

  // 压在头部这一行右边的"别人的东西":别人的流速标 + 其它绝对定位的浮层。
  function headerOverlays(article, row) {
    const rowRect = row.getBoundingClientRect();
    const out = [];
    const foreign = findForeignChip(article);
    if (foreign) out.push(foreign);
    for (const el of article.children) {
      if (el.contains(row) || isOurs(el) || el === foreign || (foreign && el.contains(foreign))) continue;   // 自己的元素不算"别人的浮层"
      const pos = getComputedStyle(el).position;
      if (pos !== "absolute" && pos !== "fixed") continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.bottom <= rowRect.top || r.top >= rowRect.bottom) continue;
      if (r.right <= rowRect.left || r.left >= rowRect.right) continue;   // 横向也要真的压在这一行上
      out.push(el);
    }
    return out;
  }

  // 固定放头部时:让到浮层的左边,不盖也不被盖
  function avoidOverlays(chip, article, row, menu) {
    const menuLeft = menu.getBoundingClientRect().left;
    let gap = 8;
    for (const el of headerOverlays(article, row)) gap = Math.max(gap, menuLeft - el.getBoundingClientRect().left + 6);
    const v = Math.round(gap) + "px";
    if (chip.style.marginRight !== v) chip.style.marginRight = v;
  }

  // 页面底色:body 的背景;是透明的就看 html 的;还是透明就用白色。角落标要用它当底色才盖得住别人的标。
  function pageBg() {
    for (const el of [document.body, document.documentElement]) {
      const bg = getComputedStyle(el).backgroundColor;
      if (bg && !/^rgba\(.*,\s*0\)$/.test(bg) && bg !== "transparent") return bg;
    }
    return "#fff";
  }



  // 图标单独包一层(动效要让图标单独抖动),其余是文字
  function setChip(chip, text, emoji) {
    chip.textContent = "";
    if (chip.classList.contains("fl-fx")) {      // 动效的渐变层(放在最底下,不挡文字)
      const bg = document.createElement("span");
      bg.className = "fl-fxbg";
      chip.append(bg);
    }
    const e = document.createElement("span");
    e.className = "fl-emo";
    e.textContent = emoji;
    chip.append(e, document.createTextNode(text.slice(emoji.length)));
  }
  const fmtAge = (h) => (h < 1 ? Math.round(h * 60) + " 分钟" : h < 48 ? h.toFixed(1) + " 小时" : Math.round(h / 24) + " 天");

  const flowRechecked = new WeakSet();   // 每条推文只在放好后复查一次位置
  const flowCardData = new WeakMap();    // article -> 悬停信息卡要用的数据(芯片和头像特效共用)

  // 从详细到简略的几档写法(d = 标上显示的内容:图标、档名、倍数文字)
  function flowLevels(place, d, arrow) {
    const full = `${d.emoji} ${d.name} ${d.text}${arrow}`;
    return place !== "b"
      ? [{ t: full }, { t: `${d.emoji} ${d.text}${arrow}` }, { t: `${d.emoji}${arrow}` }]
      : [{ t: `${d.emoji} ${d.text}${arrow}` }, { t: `${d.emoji}${arrow}` }, { t: d.emoji }];
  }

  // 悬停信息卡:鼠标放到流速标、头像上的小图标时,立刻显示这条推文的流速信息(不用等浏览器原生提示的 1 秒延迟)
  function flowCardHtml(d) {
    const { flow, trend, views, usual } = d;
    const MOOD = ["刚冒头", "有人在看", "势头不错", "正在升温", "全面爆发"];
    const rows = [];
    rows.push(["每分钟被看", `<b>${flow.rate / 60 >= 10 ? Math.round(flow.rate / 60) : (flow.rate / 60).toFixed(1)} 次</b>`]);
    rows.push(["累计被看", Number(views).toLocaleString() + " 次"]);
    rows.push(["已发出", fmtAge(flow.ageH)]);
    if (usual) {
      const x = views / usual.median;
      const t = x >= 10 ? Math.round(x) : x.toFixed(1).replace(/\.0$/, "");
      rows.push(["比 TA 平时", flow.ageH < 24 ? `<b>已是 ${t} 倍</b>(还在涨)` : `<b>${t} 倍</b>`]);
    }
    if (trend) rows.push(["近段走势", `约 ${(trend.recent / 60).toFixed(trend.recent >= 600 ? 0 : 1)} 次/分钟 ${trend.dir === "up" ? '<span class="up">↗ 越传越快</span>' : trend.dir === "down" ? '<span class="down">↘ 慢下来了</span>' : "和全程差不多"}`]);
    const scale = `<div class="fl-tip-r"><span>速度刻度</span><b style="font-weight:400;font-size:11.5px">🌱&lt;0.3 🍃&lt;1.5 🌊&lt;8 🔥&lt;40 🌋≥40(次/分钟)</b></div>`;
    const notes = [
      "速度 = 累计被看 ÷ 已发出的时长",
      usual ? `“TA 平时” = 这位作者发出一天以上的 ${usual.n} 条推文,浏览量的中位数` : "",
      flow.fresh ? "刚发出来,数字还会变" : flow.old ? "发出已久,这是整段时间的平均值" : "",
    ].filter(Boolean);
    return `<div class="fl-tip-h">${flow.emoji} ${flow.name} · ${MOOD[flow.tier] || ""}</div>` + rows.map(([k, v]) => `<div class="fl-tip-r"><span>${k}</span><b>${v}</b></div>`).join("") + scale + notes.map((n) => `<div class="fl-tip-n">${n}</div>`).join("");
  }

  // 悬停时才算"TA 平时的水平",平时不花时间
  function withUsual(d) {
    const ai = authorTweets.get(d.author);
    return { ...d, usual: ai ? P.usualViews([...ai.values()], d.id, Date.now()) : null };
  }

  function bindFlowHover(el, article) {
    if (el.dataset.flHover) return;
    el.dataset.flHover = "1";
    el.addEventListener("mouseenter", () => { const d = flowCardData.get(article); if (d && settings.hoverCard) placeTip(el, flowCardHtml(withUsual(d))); });
    el.addEventListener("mouseleave", hideTip);
  }

  // 贴靠:流速标放在头部时,让它的右边缘紧贴头部右边"看得见的"按钮(Grok、菜单、Boost),上下和这个按钮居中对齐。
  // 不依赖 X 的容器结构:直接量按钮的实际位置,再用相对偏移(position:relative; left / top)挪过去。相对偏移不影响布局。
  // 注意要跳过 visibility:hidden 的按钮:被我们隐藏的别家流速标仍然占着位置,不能拿它当对齐目标。
  // X 的头部按钮是陆续渲染出来的、评论区的节点还会被回收复用,所以不只放好后量几次:watchAlign 会盯着头部,变了就重新对齐。
  function snapRight(chip) {
    if (!chip || !chip.isConnected || chip.dataset.flPlace === "b") return;
    if (settings.flowPos === "header" && !settings.hideForeign) return;   // 这个模式要让到别家流速标的左边,由 avoidOverlays 负责
    const art = chip.closest("article");
    const un = art && art.querySelector('[data-testid="User-Name"]');
    if (!un) return;
    const ur = un.getBoundingClientRect(), cr = chip.getBoundingClientRect();
    let L = Infinity, ref = null;
    for (const b of art.querySelectorAll('button, [role="button"]')) {
      if (chip.contains(b) || un.contains(b)) continue;
      const r = b.getBoundingClientRect();
      if (!r.width || !r.height || r.top < ur.top - 12 || r.top > ur.bottom + 4 || r.left <= ur.left + 60) continue;
      if (r.left >= L) continue;
      const cs = getComputedStyle(b);
      if (cs.visibility === "hidden" || cs.opacity === "0" || cs.display === "none") continue;
      L = r.left; ref = r;
    }
    if (L === Infinity) return;
    let dx = Math.round(L - 8 - cr.right);
    if (Math.abs(dx) <= 3 || dx > 900 || dx < -900) dx = 0;
    if (dx && cr.left + dx < ur.right + 4) dx = Math.round(ur.right + 4 - cr.left);   // 绝不压到名字
    if (Math.abs(dx) <= 3) dx = 0;
    let dy = Math.round(ref.top + ref.height / 2 - (cr.top + cr.height / 2));        // 和最近的可见按钮上下居中
    if (Math.abs(dy) <= 1 || Math.abs(dy) > 16) dy = 0;
    if (dx || dy) {
      chip.style.position = "relative";
      if (dx) chip.style.left = `${(parseFloat(chip.style.left) || 0) + dx}px`;
      if (dy) chip.style.top = `${(parseFloat(chip.style.top) || 0) + dy}px`;
    }
    if (settings.debug) selfCheck(chip, art, un, ref);
  }

  // 自检(只在开了"调试条"时):对齐之后量一遍,左右应该是 8px、上下应该居中;还对不上就把头部结构摘要记下来,设置里可以复制发给我
  function selfCheck(chip, art, un, ref) {
    const c = chip.getBoundingClientRect(), gap = Math.round(ref.left - c.right), dyc = Math.round(ref.top + ref.height / 2 - (c.top + c.height / 2));
    if (Math.abs(gap - 8) <= 4 && Math.abs(dyc) <= 2) return;
    const row = headerRow(un);
    const sk = (e, d) => ({ t: e.tagName.toLowerCase() + (e.getAttribute("data-testid") ? "#" + e.getAttribute("data-testid") : "") + (e.getAttribute("role") ? "[" + e.getAttribute("role") + "]" : ""), r: [Math.round(e.getBoundingClientRect().left), Math.round(e.getBoundingClientRect().top), Math.round(e.getBoundingClientRect().width), Math.round(e.getBoundingClientRect().height)], c: d > 0 ? [...e.children].slice(0, 8).map((k) => sk(k, d - 1)) : undefined });
    const rec = { at: new Date().toISOString(), path: location.pathname, gap, dy: dyc, chip: [Math.round(c.left), Math.round(c.top), Math.round(c.width), Math.round(c.height)], row: row ? sk(row, 3) : null };
    console.warn("[粉丝透镜] 位置对不上", rec);
    if (storage) storage.get("fl_diag").then((o) => storage.set({ fl_diag: [...(o.fl_diag || []), rec].slice(-10) }));
  }

  // 盯着头部:它的尺寸变了(按钮晚到、节点被回收重画、窗口变窄)就重新对齐。
  // 对齐只改 left/top(相对偏移),不改尺寸也不改子节点,所以不会触发自己
  const alignWatched = new WeakSet();
  const alignQueue = new Set();
  let alignRaf = 0;
  function queueAlign(art) {
    alignQueue.add(art);
    if (alignRaf) return;
    alignRaf = requestAnimationFrame(() => {
      alignRaf = 0;
      for (const a of alignQueue) { const c = a.isConnected && a.querySelector(".fl-flow"); if (c) snapRight(c); }
      alignQueue.clear();
    });
  }
  function watchAlign(art, row) {
    if (!row || alignWatched.has(row)) return;
    alignWatched.add(row);
    const ro = new ResizeObserver(() => queueAlign(art));
    ro.observe(row);
    if (row.lastElementChild) ro.observe(row.lastElementChild);
    new MutationObserver((ms) => { if (ms.some((m) => !(m.target.closest && m.target.closest(".fl-flow")) && !(m.target.classList && m.target.classList.contains("fl-flow")))) queueAlign(art); })
      .observe(row, { childList: true, subtree: true });
  }

  function decorateFlow(article) {
    const old = article.querySelector(".fl-flow");
    const id = tweetIdOf(article);
    const info = id && tweetInfo.get(id);
    const author = info && users.get(info.author);
    // 所有档位、所有年龄(1 分钟 ~ 30 天)的推文都显示,和别人的流速插件对齐;不再藏任何一档
    const flow = settings.flow && info ? P.flowOf(info, author ? author.followers : 0, Date.now(), settings.flowMode) : null;
    if (!flow) { flowTier.set(article, -1); if (old) old.remove(); flowCardData.delete(article); return; }

    const trend = flow.old ? null : P.trendOf(info.obs, flow.rate);
    const arrow = trend ? (trend.dir === "up" ? " ↗" : trend.dir === "down" ? " ↘" : "") : "";
    const disp = { tier: flow.tier, emoji: flow.emoji, name: flow.name, text: `${P.fmtPace(flow.rate)}/分` };
    flowTier.set(article, flow.tier);
    // key = 结构(档位 + 设置);sig0 = 结构 + 数字。
    // 稳态快路径:什么都没变,直接返回,不读任何布局(getComputedStyle / getBoundingClientRect 会强制同步重排)
    const key = `${disp.tier}|${settingsVer}`;
    const sig0 = `${key}|${disp.text}|${arrow}`;
    if (old && old.isConnected && old.dataset.flSig0 === sig0) return;
    flowCardData.set(article, { flow, trend, views: info.views, id, author: info.author });
    // 只是数字变了(每次刷新浏览量都会变一点):原地改文字。不删不重建、不重新定位、动画也不会重新开始
    if (old && old.isConnected && old.dataset.flKey === key) {
      const levels = flowLevels(old.dataset.flPlace, disp, arrow);
      const lv = levels[Math.min(+old.dataset.flLevel || 0, levels.length - 1)];
      const node = [...old.childNodes].find((n) => n.nodeType === 3);
      if (node) node.nodeValue = lv.t.slice(disp.emoji.length);
      old.dataset.flSig0 = sig0;
      snapRight(old);
      return;
    }

    const un = article.querySelector('[data-testid="User-Name"]');
    const link = article.querySelector('[role="group"] a[href$="/analytics"]');
    // 位置:corner(替换,默认)= 排进标题行(菜单区左边),并把别的插件的流速标隐藏掉,换成我们的;
    //       header = 同样排进标题行,但不隐藏别人的、并让到别人的标左边;auto = 标题行右侧没被占就放标题行,否则放底部;bar = 底部
    const row = un && headerRow(un);
    const menu = row && row.lastElementChild;
    const headerOk = !!menu && !menu.classList.contains("fl-flow");
    const cell = link && link.parentElement;
    const mode = settings.flowPos;
    const overlaid = headerOk && !settings.hideForeign && headerOverlays(article, row).length > 0;   // 别人的标被隐藏了就不算"占着"
    let place = headerOk && (mode === "header" || mode === "corner" || (mode === "auto" && !overlaid)) ? "h" : cell ? "b" : headerOk ? "h" : "";
    if (!place) { if (old) old.remove(); return; }

    if (old) old.remove();

    const chip = document.createElement("span");
    chip.className = `fl-flow f${disp.tier}` + (place === "h" ? " fl-flow-h" : "") + (settings.flowFx && disp.tier >= 3 ? " fl-fx" : "");
    chip.dataset.flKey = key;
    chip.dataset.flSig0 = sig0;
    bindFlowHover(chip, article);

    // 从详细到简略,放得下哪个就用哪个;记下选了第几档,之后原地更新文字时沿用
    let levels = flowLevels(place, disp, arrow);
    let level = 0;
    if (place === "h") {
      // 先撤下这条推文已有的粉丝徽标,等流速标就位后,render 会按"放得下行内、放不下换行"重新放
      const rec = placed.get(un);
      if (rec) { rec.badge.remove(); if (rec.line) rec.line.remove(); placed.delete(un); }
      menu.before(chip);
      let fitted = false;
      for (let i = 0; i < levels.length; i++) { level = i; setChip(chip, levels[i].t, disp.emoji); if (!crowded(un, chip)) { fitted = true; break; } }
      // 连图标都会压住名字或时间(名字特别长的时候):改放到底部浏览量旁,绝不遮挡文字
      if (!fitted && cell) {
        place = "b"; chip.classList.remove("fl-flow-h"); chip.remove();
        cell.append(chip);
        levels = flowLevels("b", disp, arrow);
        for (let i = 0; i < levels.length; i++) { level = i; setChip(chip, levels[i].t, disp.emoji); if (cell.scrollWidth <= cell.clientWidth + 1) break; }
      } else if (mode === "header" && !settings.hideForeign) avoidOverlays(chip, article, row, menu);
      snapRight(chip);
      if (place === "h") watchAlign(article, row);
    } else {
      cell.append(chip);
      for (let i = 0; i < levels.length; i++) { level = i; setChip(chip, levels[i].t, disp.emoji); if (cell.scrollWidth <= cell.clientWidth + 1) break; }
    }
    chip.dataset.flPlace = place;
    chip.dataset.flLevel = String(level);

    // 放好 1.5 秒和 4 秒后各复查一次(别的插件的标可能晚到)。只在"位置决策真的变了"时才重建,否则不动
    if (!flowRechecked.has(article)) {
      flowRechecked.add(article);
      const recheck = () => {
        const c2 = article.querySelector(".fl-flow");
        if (!c2 || !c2.isConnected) return;
        const un2 = article.querySelector('[data-testid="User-Name"]');
        const row2 = un2 && headerRow(un2);
        if (!row2) return;
        snapRight(c2);
        const pl = c2.dataset.flPlace, md = settings.flowPos;
        if (pl === "h" && md === "header" && !settings.hideForeign) { avoidOverlays(c2, article, row2, row2.lastElementChild); return; }
        if (md === "auto" && !settings.hideForeign) {
          const want = headerOverlays(article, row2).length > 0 ? "b" : "h";
          if (want !== pl) { c2.dataset.flKey = ""; c2.dataset.flSig0 = ""; scheduleRender(); }
        }
      };
      setTimeout(recheck, 1500);
      setTimeout(recheck, 4000);
      setTimeout(recheck, 9000);
    }
  }

  // ----- 头像光环:按这条推文的流速,每一档配不一样的光环 -----
  // 头像是圆的还是方的:true 圆 / false 方 / null 还读不到(图片没加载完,圆角样式还没落下来)
  // 个人头像圆角是 9999px,企业号的方头像是几 px 的小圆角。
  function roundness(container) {
    let e = container.querySelector("img") || container, up = 0, passed = false;
    while (e && up <= 4) {
      const r = getComputedStyle(e).borderRadius;
      if (r && r !== "0px") {
        const px = parseFloat(r);
        return r.includes("%") || px >= 20;
      }
      if (e === container) passed = true;
      if (passed) up++;
      e = e.parentElement;
    }
    return null;
  }

  // ----- 头像速度环:一圈彗星环 + 一个沿环跑的小图标,转速就是流速 -----
  // 动画只用 transform(合成线程)。方形头像(企业号)不转,只留静态圈和角标。
  const AV_EMOJI = ["🌱", "🍃", "🌊", "🔥", "🌋"];
  const mk = (cls, text) => { const s = document.createElement("span"); s.className = cls; if (text) s.textContent = text; return s; };

  function removeAvatarFx(container) {
    container.querySelectorAll(":scope > .fl-ring, :scope > .fl-ring-badge, :scope > .fl-avx").forEach((n) => n.remove());
  }

  function buildAvatarFx(container, tier, round, article) {
    if (round) {
      const w = mk(`fl-avx ax${tier}` + (settings.avatarSpin ? " spin" : ""));
      const orbit = mk("fl-orbit"); orbit.append(mk("fl-orbit-i", AV_EMOJI[tier])); w.append(orbit);
      container.append(w);
    }
    // 鼠标放到头像(含小图标)上,立刻显示这条推文的流速信息
    if (!container.dataset.flHover) {
      container.dataset.flHover = "1";
      container.addEventListener("mouseenter", () => { const d = flowCardData.get(article); if (d && settings.hoverCard) placeTip(container, flowCardHtml(withUsual(d))); });
      container.addEventListener("mouseleave", hideTip);
    }
  }

  function decorateAvatar(article) {
    const container = article.querySelector('[data-testid^="UserAvatar-Container-"]');
    if (!container) return;
    const tier = flowTier.get(article);
    const want = settings.avatarFx && tier >= 0 ? tier : -1;   // 每一档都有(慢档低调,快档华丽);只有没有流速标的推文没有
    const sig = `${want}|${settings.avatarSpin ? 1 : 0}`;
    const ring = container.querySelector(":scope > .fl-ring");
    if (want < 0) { if (ring) removeAvatarFx(container); return; }
    if (ring && ring.dataset.flTier === sig) {
      // 稳态快路径。只有"形状还没读到"的,在前几次渲染里补判一次(之后不再读样式)
      if (ring.dataset.flShape === "?" && (+ring.dataset.flChecks || 0) < 4) {
        ring.dataset.flChecks = String((+ring.dataset.flChecks || 0) + 1);
        const sh = roundness(container);
        if (sh === false) { removeAvatarFx(container); scheduleRender(); }   // 其实是方的:拆掉重建成方形版(没有绕圈角色)
        else if (sh === true) ring.dataset.flShape = "r";
      }
      return;
    }
    const shape = roundness(container);               // 读不到就按圆形(绝大多数是个人头像),稍后补判
    const round = shape !== false;
    if (ring) removeAvatarFx(container);
    const el = mk(`fl-ring r${want}` + (settings.avatarSpin ? " spin" : "") + (round ? " round" : " square"));
    el.dataset.flTier = sig;
    el.dataset.flShape = shape === null ? "?" : round ? "r" : "s";
    container.append(el);
    // 角标只给方形头像(它不转);圆形头像已经有沿环跑的小图标
    if (want >= 3 && !round) container.append(mk("fl-ring-badge", want === 4 ? "🌋" : "🔥"));
    buildAvatarFx(container, want, round, article);
  }


  // ---------- 评论区:大 V 的回复高亮,低质量账号的回复可选淡化 ----------
  function markReplies(arts) {
    const m = location.pathname.match(/^\/[A-Za-z0-9_]{1,15}\/status\/(\d+)/);
    for (const a of arts) {
      let vip = false, dim = false;
      if (m && settings.enabled && (settings.replyMark || settings.replyDim)) {
        const id = tweetIdOf(a);
        const un = a.querySelector('[data-testid="User-Name"]');
        const handle = un && handleOf(un);
        const u = handle && users.get(handle);
        if (u && id !== m[1]) {
          const list = P.tags(u, stats.get(handle), Date.now(), settings, null);
          vip = settings.replyMark && list.some((t) => t.key === "bigV");
          dim = settings.replyDim && P.shouldDim(list);
        }
      }
      if (a.classList.contains("fl-vip") !== vip) a.classList.toggle("fl-vip", vip);
      if (a.classList.contains("fl-dimreply") !== dim) a.classList.toggle("fl-dimreply", dim);
    }
  }

  // ---------- 粉丝构成 ----------
  const fmtPct = (x, n) => (n ? (x / n * 100).toFixed(x / n >= 0.1 ? 0 : 1) : "0") + "%";
  function fansTotal(owner) { const u = users.get(owner); return u ? u.followers : 0; }
  // ---------- 自动加载整份列表 ----------
  // 做法:自己不发任何请求,只是把页面往下滚到列表最底下,让 X 自己的"加载下一页"一页页触发(和你手动往下滚一模一样),
  // 数据到了照旧由已有的逻辑记下来。你一动鼠标滚轮/触摸/键盘就立刻停。
  // 为了对 X 客气:每步间隔 1.2–2 秒;连续 3 次(每次等 6 秒)没有新数据就停(列表到头了,或者 X 暂时限流);一次最多 AUTO_MAX 位。
  const AUTO_MAX = 5000;
  const auto = { running: false, kind: "", owner: "", stop: false, msg: "" };
  const autoLast = new Map();   // owner|kind -> 上一次自动加载结束的时间,避免页面重绘后又自动开始
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function runAuto(kind, owner) {
    if (auto.running || !owner) return;
    const store = kind === "fans" ? fans : follows;
    const ownerOf = kind === "fans" ? fansOwner : followsOwner;
    const size = () => (store.get(owner) ? store.get(owner).rows.size : 0);
    const total = () => { const u = users.get(owner); return u ? (kind === "fans" ? u.followers : u.following) : 0; };
    auto.running = true; auto.kind = kind; auto.owner = owner; auto.stop = false; auto.msg = "";
    const onUser = (e) => { if (e.isTrusted) { auto.stop = true; auto.msg = "已暂停(你操作了页面)"; } };
    const evs = ["wheel", "touchstart", "keydown", "mousedown"];
    for (const ev of evs) window.addEventListener(ev, onUser, true);
    let stalls = 0, last = size(), finished = false;
    scheduleRender();
    try {
      while (!auto.stop && ownerOf() === owner && size() < AUTO_MAX) {
        // 直接滚到页面最底(在你的真实页面上量过:对最后一个 UserCell 做 scrollIntoView 没用,X 的列表是虚拟化的,滚到底才会触发加载)
        window.scrollTo(0, document.documentElement.scrollHeight);
        await sleep(1200 + Math.random() * 800);
        let waited = 0;
        while (size() === last && waited < 6000 && !auto.stop && ownerOf() === owner) { await sleep(400); waited += 400; }
        if (size() === last) { if (++stalls >= 3) break; } else { stalls = 0; last = size(); }
        scheduleRender();
        if (total() && size() >= total() * 0.995) { finished = true; break; }
      }
    } finally {
      for (const ev of evs) window.removeEventListener(ev, onUser, true);
      auto.running = false;
      autoLast.set(owner + "|" + kind, Date.now());
      const n = size(), t = total();
      if (!auto.msg) {
        auto.msg = ownerOf() !== owner ? "" : finished || (t && n >= t * 0.97) ? "加载完毕" : size() >= AUTO_MAX ? `已到上限(${AUTO_MAX.toLocaleString()} 位)` : "停住了:列表到头了,或者 X 暂时限流,过一会儿再点一次";
      }
      if (ownerOf() === owner && !/暂停/.test(auto.msg)) window.scrollTo(0, 0);
      scheduleRender();
    }
  }
  const autoBtnLabel = (kind, owner) => (auto.running && auto.kind === kind && auto.owner === owner ? "停止" : "自动加载全部");
  function wireAutoBtn(bar, kind, owner) {
    const b = bar.querySelector(".fl-auto-btn");
    b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); if (auto.running) { auto.stop = true; auto.msg = "已停止"; } else runAuto(kind, owner); });
  }
  function maybeAutoStart(kind, owner, enabled) {
    if (!enabled || auto.running || !document.querySelector('[data-testid="UserCell"]')) return;
    if (Date.now() - (autoLast.get(owner + "|" + kind) || 0) < 10 * 60e3) return;   // 刚跑过(或刚被你停掉),别自己又开始
    autoLast.set(owner + "|" + kind, Date.now());
    setTimeout(() => { if ((kind === "fans" ? fansOwner() : followsOwner()) === owner) runAuto(kind, owner); }, 800);
  }
  const autoStatus = (kind, owner, n, total) => auto.running && auto.kind === kind && auto.owner === owner ? (auto.stop ? "正在停止…" : `⏳ 正在加载…已统计 ${n.toLocaleString()}${total ? ` / ${total.toLocaleString()}` : ""}(动一下鼠标滚轮就停)`) : auto.owner === owner && auto.kind === kind && auto.msg ? auto.msg : "";

  function ensureFansBar() {
    const old = document.querySelector(".fl-fans-bar");
    const owner = settings.fansBar && settings.enabled ? fansOwner() : null;
    const tabs = owner && document.querySelector('[data-testid="primaryColumn"] [role="tablist"]');
    if (!tabs) { if (old) old.remove(); return; }
    const rec = fans.get(owner), n = rec ? rec.rows.size : 0, total = fansTotal(owner);
    const st = autoStatus("fans", owner, n, total);
    const text = st && auto.running ? st : (n ? `📊 已统计 ${n.toLocaleString()}${total ? ` / ${total.toLocaleString()}` : ""} 位粉丝` : "📊 往下滚动粉丝列表,边看边统计粉丝构成") + (st ? " · " + st : "");
    // X 的标签栏在一个 sticky 的头部里,在里面插东西会被列表盖住。放在这个头部后面,跟着列表一起滚
    let anchor = tabs;
    for (let n = tabs.parentElement, i = 0; n && i < 8 && n.getAttribute("data-testid") !== "primaryColumn"; n = n.parentElement, i++) {
      if (getComputedStyle(n).position === "sticky") { anchor = n; break; }
    }
    let bar = old;
    if (!bar || bar.dataset.o !== owner || bar.previousElementSibling !== anchor) {
      if (bar) bar.remove();
      bar = document.createElement("div");
      bar.className = "fl-fans-bar"; bar.dataset.o = owner;
      const t = document.createElement("span"); t.className = "fl-fans-t";
      const g = document.createElement("span"); g.className = "fl-bar-btns";
      const ab = document.createElement("button"); ab.type = "button"; ab.className = "fl-auto-btn";
      const b = document.createElement("button"); b.type = "button"; b.textContent = "查看粉丝构成";
      b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); openFans(owner); });
      g.append(ab, b);
      bar.append(t, g);
      wireAutoBtn(bar, "fans", owner);
      anchor.insertAdjacentElement("afterend", bar);
    }
    const t = bar.firstElementChild;
    if (t.textContent !== text) t.textContent = text;
    const ab = bar.querySelector(".fl-auto-btn"), lab = autoBtnLabel("fans", owner);
    if (ab.textContent !== lab) ab.textContent = lab;
    maybeAutoStart("fans", owner, settings.fansAuto);
  }

  // Esc 关面板:全局只挂一次(以前每打开一次面板挂一个,用按钮关掉时不会摘掉,越攒越多)
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && document.getElementById("fl-fans-modal")) closeFans(); });
  function closeFans() { const m = document.getElementById("fl-fans-modal"); if (m) m.remove(); }
  function openFans(owner) {
    closeFans();
    const rec = fans.get(owner), rows = rec ? [...rec.rows.entries()] : [];
    const lines = P.parseFansLines(settings.fansLines);
    const now = Date.now();
    const sum = P.fansSummary(rows.map(([, r]) => r), lines, now), total = fansTotal(owner);
    const modal = document.createElement("div"); modal.id = "fl-fans-modal";
    const box = document.createElement("div"); box.className = "fl-fans-box";
    const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
    box.append(h("div", "fl-fans-h", `<b>@${esc(owner)}</b> 的粉丝构成`));
    const cov = total ? Math.min(100, sum.n / total * 100) : null;
    box.append(h("div", "fl-fans-cov", sum.n ? `已统计 <b>${sum.n.toLocaleString()}</b>${total ? ` / ${total.toLocaleString()} 位粉丝(${cov.toFixed(cov >= 10 ? 0 : 1)}%)` : " 位粉丝"}。只统计已经加载出来的:点列表页顶部的「自动加载全部」可以让它自己往下滚;粉丝越多越不全(自动加载一次最多 5,000 位)。` : "还没有数据。回到粉丝列表往下滚动,粉丝透镜会边看边统计。"));
    if (sum.n) {
      const key = h("div", "fl-fans-key");
      for (const [lab, n] of [["≥ 3000", sum.ge3k], ["≥ 1万", sum.ge10k], ["≥ 3万", sum.ge30k]]) key.append(h("div", "fl-fans-k", `<b>${n.toLocaleString()}</b><span>${lab}</span><i>${fmtPct(n, sum.n)}</i>`));
      box.append(key);
      const max = Math.max(...sum.counts, 1);
      const bands = h("div", "fl-fans-bands");
      const detail = h("div", "fl-fans-list");
      const showBand = (i) => {
        const lo = i === 0 ? 0 : lines[i - 1], hi = i < lines.length ? lines[i] : Infinity;
        const list = rows.filter(([, r]) => r[0] >= lo && r[0] < hi).sort((a, b) => b[1][0] - a[1][0]).slice(0, 60);
        detail.innerHTML = `<div class="fl-fans-lh">${esc(sum.names[i])} · 共 ${sum.counts[i].toLocaleString()} 位${sum.counts[i] > 60 ? ",显示粉丝最多的 60 位" : ""}</div>` +
          list.map(([hd, r]) => `<a href="https://x.com/${esc(hd)}" target="_blank" rel="noreferrer">@${esc(hd)}<span>${P.fmt(r[0])}</span></a>`).join("");
        bands.querySelectorAll(".fl-fans-band").forEach((el, k) => el.classList.toggle("on", k === i));
      };
      sum.names.forEach((name, i) => {
        const row = h("button", "fl-fans-band", `<span class="n">${esc(name)}</span><span class="b"><i style="width:${Math.max(sum.counts[i] ? 2 : 0, sum.counts[i] / max * 100)}%"></i></span><span class="c">${sum.counts[i].toLocaleString()}<em>${fmtPct(sum.counts[i], sum.n)}</em></span>`);
        row.type = "button"; row.addEventListener("click", () => showBand(i));
        bands.append(row);
      });
      box.append(bands);
      box.append(h("div", "fl-fans-extra", `疑似互粉号 <b>${fmtPct(sum.farm, sum.n)}</b> · 注册不到 90 天的新号 <b>${fmtPct(sum.fresh, sum.n)}</b>`));
      box.append(detail);
    }
    const foot = h("div", "fl-fans-foot");
    const mk = (txt, fn, cls) => { const b = h("button", cls || "", txt); b.type = "button"; b.addEventListener("click", fn); return b; };
    if (sum.n) {
      foot.append(mk("导出 CSV", () => {
        const csv = "\ufeffhandle,粉丝数,关注数,注册时间\n" + rows.map(([hd, r]) => `${hd},${r[0]},${r[1]},${r[2] ? new Date(r[2]).toISOString().slice(0, 10) : ""}`).join("\n");
        const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = `fans-${owner}.csv`; document.body.append(a); a.click(); a.remove();
      }));
      foot.append(mk("清除这个账号的统计", () => { fans.delete(owner); fansDirty = true; flushSaveNow(); closeFans(); scheduleRender(); }, "ghost"));
    }
    foot.append(mk("关闭", closeFans, "ghost"));
    box.append(foot);
    modal.append(box);
    modal.addEventListener("click", (e) => { if (e.target === modal) closeFans(); });
    document.documentElement.append(modal);
  }
  // ---------- 关注列表分析 ----------
  function stickyAnchor(tabs) {
    for (let n = tabs.parentElement, i = 0; n && i < 8 && n.getAttribute("data-testid") !== "primaryColumn"; n = n.parentElement, i++) {
      if (getComputedStyle(n).position === "sticky") return n;
    }
    return tabs;
  }
  function ensureFollowsBar() {
    const old = document.querySelector(".fl-fol-bar");
    const owner = settings.followsBar && settings.enabled ? followsOwner() : null;
    const tabs = owner && document.querySelector('[data-testid="primaryColumn"] [role="tablist"]');
    if (!tabs) { if (old) old.remove(); return; }
    const rec = follows.get(owner), n = rec ? rec.rows.size : 0, u = users.get(owner), total = u ? u.following : 0;
    const st = autoStatus("follows", owner, n, total);
    const text = st && auto.running ? st : (n ? `📋 已统计 ${n.toLocaleString()}${total ? ` / ${total.toLocaleString()}` : ""} 位关注的人` : "📋 往下滚动关注列表,边看边统计") + (st ? " · " + st : "");
    const anchor = stickyAnchor(tabs);
    let bar = old;
    if (!bar || bar.dataset.o !== owner || bar.previousElementSibling !== anchor) {
      if (bar) bar.remove();
      bar = document.createElement("div");
      bar.className = "fl-fol-bar"; bar.dataset.o = owner;
      const t = document.createElement("span");
      const g = document.createElement("span"); g.className = "fl-bar-btns";
      const ab = document.createElement("button"); ab.type = "button"; ab.className = "fl-auto-btn";
      const b = document.createElement("button"); b.type = "button"; b.textContent = "关注分析";
      b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); openFollows(owner); });
      g.append(ab, b);
      bar.append(t, g);
      wireAutoBtn(bar, "follows", owner);
      anchor.insertAdjacentElement("afterend", bar);
    }
    const t = bar.firstElementChild;
    if (t.textContent !== text) t.textContent = text;
    const ab = bar.querySelector(".fl-auto-btn"), lab = autoBtnLabel("follows", owner);
    if (ab.textContent !== lab) ab.textContent = lab;
    maybeAutoStart("follows", owner, settings.followsAuto);
  }

  const csvCell = (v) => {
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;   // 推文开头是 = + - @ 时,Excel 会当公式执行;加个单引号让它只是文字
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  function downloadCsv(name, lines) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + lines.join("\n")], { type: "text/csv" }));
    a.download = name; document.body.append(a); a.click(); a.remove();
  }
  function modalShell(title) {
    closeFans();
    const modal = document.createElement("div"); modal.id = "fl-fans-modal";
    const box = document.createElement("div"); box.className = "fl-fans-box";
    const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
    box.append(h("div", "fl-fans-h", title));
    modal.append(box);
    modal.addEventListener("click", (e) => { if (e.target === modal) closeFans(); });
    document.documentElement.append(modal);
    return { box, h };
  }

  function openFollows(owner) {
    const rec = follows.get(owner), rows = rec ? [...rec.rows.entries()] : [];
    const now = Date.now(), total = (users.get(owner) || {}).following || 0;
    const { box, h } = modalShell(`<b>@${esc(owner)}</b> 的关注分析`);
    const sum = P.followsSummary(rows.map(([, r]) => r), now);
    box.append(h("div", "fl-fans-cov", sum.n ? `已统计 <b>${sum.n.toLocaleString()}</b>${total ? ` / ${total.toLocaleString()} 位关注的人` : " 位"}。只统计你已经在列表里滚动加载过的。"没关注你"指的是这些人里目前没有关注你的(以你当前登录的账号为准)。` : "还没有数据。回到\"正在关注\"列表往下滚动,粉丝透镜会边看边统计。"));
    if (!sum.n) { const foot = h("div", "fl-fans-foot"); const b = h("button", "ghost", "关闭"); b.type = "button"; b.addEventListener("click", closeFans); foot.append(b); box.append(foot); return; }
    let filter = "all", sort = "fol";
    const chipsEl = h("div", "fl-fol-chips"), listEl = h("div", "fl-fol-list"), bar = h("div", "fl-fol-sort");
    const sel = h("select"); for (const k in P.FOLLOW_SORTS) { const o = h("option", "", P.FOLLOW_SORTS[k].name); o.value = k; sel.append(o); }
    sel.addEventListener("change", () => { sort = sel.value; paint(); });
    bar.append(h("span", "", "排序"), sel);
    const cur = () => rows.filter(([, r]) => P.FOLLOW_FILTERS[filter].fn(r, now)).sort(P.FOLLOW_SORTS[sort].cmp);
    const paint = () => {
      chipsEl.innerHTML = "";
      for (const k in P.FOLLOW_FILTERS) { const b = h("button", k === filter ? "on" : "", `${P.FOLLOW_FILTERS[k].name}<em>${sum[k]}</em>`); b.type = "button"; b.addEventListener("click", () => { filter = k; paint(); }); chipsEl.append(b); }
      const list = cur(), show = list.slice(0, 100);
      listEl.innerHTML = `<div class="fl-fans-lh">${esc(P.FOLLOW_FILTERS[filter].name)} · 共 ${list.length.toLocaleString()} 位${list.length > 100 ? ",显示前 100 位" : ""}</div>` +
        show.map(([hd, r]) => `<a href="https://x.com/${esc(hd)}" target="_blank" rel="noreferrer"><b>@${esc(hd)}</b><span>${P.fmt(r[0])} 粉</span><i>比 ${P.fmtRatio(r[0] / Math.max(1, r[1]))}</i><em class="${r[4] ? "ok" : "no"}">${r[4] ? "互关" : "没关注你"}</em></a>`).join("");
    };
    box.append(chipsEl, bar, listEl);
    paint();
    const foot = h("div", "fl-fans-foot");
    const mk = (txt, fn, cls) => { const b = h("button", cls || "", txt); b.type = "button"; b.addEventListener("click", fn); return b; };
    foot.append(mk("导出当前筛选 CSV", () => downloadCsv(`follows-${owner}.csv`, ["handle,粉丝数,关注数,注册时间,是否关注你", ...cur().map(([hd, r]) => [hd, r[0], r[1], r[2] ? new Date(r[2]).toISOString().slice(0, 10) : "", r[4] ? "是" : "否"].map(csvCell).join(","))])));
    foot.append(mk("清除这个账号的统计", () => { follows.delete(owner); followsDirty = true; flushSaveNow(); closeFans(); scheduleRender(); }, "ghost"));
    foot.append(mk("关闭", closeFans, "ghost"));
    box.append(foot);
  }

  // ---------- 推文复盘:这个账号你刷到过的推文,哪几条最好、什么时段发得最好 ----------
  const REVIEW_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h16"/><rect x="5" y="11" width="3.2" height="6" rx="1"/><rect x="10.4" y="6" width="3.2" height="11" rx="1"/><rect x="15.8" y="9" width="3.2" height="8" rx="1"/></svg>';
  function ensureReviewBtn() {
    const old = document.querySelector(".fl-rev-btn");
    const handle = settings.reviewBtn ? profileHandle() : null;
    const card = handle && document.querySelector(".fl-card-btn.in-row");
    const act = handle && document.querySelector('[data-testid="userActions"], [data-testid="editProfileButton"]');
    const row = act && act.parentElement && act.parentElement.getBoundingClientRect().height ? act.parentElement : null;
    // 名片图标开着就挨着它放;名片图标被关掉了,也要能单独出现在那排按钮的最左边
    if (!handle || !users.has(handle) || !(card || row)) { if (old) old.remove(); return; }
    if (old && old.dataset.h === handle && old.isConnected && (card ? old.previousElementSibling === card : row.firstElementChild === old)) return;
    if (old) old.remove();
    const b = document.createElement("button");
    b.type = "button"; b.className = "fl-rev-btn in-row"; b.dataset.h = handle; b.setAttribute("aria-label", "推文复盘");
    b.innerHTML = REVIEW_ICON;
    b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); hideTip(); openReview(handle); });
    b.addEventListener("mouseenter", () => placeTip(b, '<div class="fl-tip-h">📈 推文复盘</div><div class="fl-tip-n">你刷到过的这个账号的推文:哪几条最好、什么时段发得最好</div>'));
    b.addEventListener("mouseleave", hideTip);
    if (card) card.insertAdjacentElement("afterend", b); else row.insertBefore(b, row.firstElementChild);
    if (act) { alignCardBtn(b, act); setTimeout(() => alignCardBtn(b, act), 800); setTimeout(() => alignCardBtn(b, act), 2500); }
  }

  function openReview(handle) {
    const ai = authorTweets.get(handle), items = ai ? [...ai.values()] : [], now = Date.now();
    const u = users.get(handle) || {};
    const { box, h } = modalShell(`<b>@${esc(handle)}</b> 的推文复盘`);
    const sum = P.tweetsSummary(items, now);
    box.append(h("div", "fl-fans-cov", sum.n ? `已统计 <b>${sum.n}</b> 条推文(只算你已经刷到、并且有浏览量的),其中发出一天以上的 ${sum.nMature} 条用来看发帖时段。在个人主页多往下滚几屏,统计会更完整。` : "还没有数据。到这个账号的个人主页往下滚动,粉丝透镜会边看边统计它的推文。"));
    if (sum.n) {
      const key = h("div", "fl-fans-key");
      key.append(h("div", "fl-fans-k", `<b>${Math.round(sum.median).toLocaleString()}</b><span>浏览量中位数</span><i>${u.followers ? "约粉丝量的 " + (sum.median / u.followers * 100).toFixed(sum.median / u.followers >= 0.1 ? 0 : 1) + "%" : ""}</i>`));
      key.append(h("div", "fl-fans-k", `<b>${sum.er === null ? "—" : (sum.er * 100).toFixed(2) + "%"}</b><span>平均互动率</span><i>点赞+转发+回复+引用 ÷ 浏览</i>`));
      key.append(h("div", "fl-fans-k", `<b>${sum.top[0].views.toLocaleString()}</b><span>最高浏览量</span><i>${esc(sum.top[0].text || "")}</i>`));
      box.append(key);
      box.append(h("div", "fl-rev-sec", "发帖时段(按发出一天以上的推文平均浏览量)"));
      const maxAvg = Math.max(...sum.blocks.map((b) => b.avg), 1);
      const bl = h("div", "fl-fans-bands");
      for (const b of sum.blocks) {
        const best = sum.best && sum.best.name === b.name;
        bl.append(h("div", "fl-fans-band" + (best ? " on" : ""), `<span class="n">${esc(b.name)}</span><span class="b"><i style="width:${b.n ? Math.max(2, b.avg / maxAvg * 100) : 0}%"></i></span><span class="c">${b.n ? Math.round(b.avg).toLocaleString() : "—"}<em>${b.n} 条${best ? " ★" : ""}</em></span>`));
      }
      box.append(bl);
      box.append(h("div", "fl-fans-extra", sum.best ? `平均浏览量最高的时段是 <b>${esc(sum.best.name)}</b>(样本不大,仅供参考)。` : "样本还不够下结论(至少要有两个时段,各有 2 条以上发出一天的推文)。"));
      box.append(h("div", "fl-rev-sec", "浏览量最高的 10 条"));
      const list = h("div", "fl-rev-list");
      list.innerHTML = sum.top.map((t, i) => {
        const f = P.flowOf({ views: t.views, createdAt: t.createdAt }, 0, now);
        const er = t.views ? (t.inter || 0) / t.views : 0;
        return `<a href="https://x.com/${esc(handle)}/status/${esc(t.id)}" target="_blank" rel="noreferrer"><b>${i + 1}</b><span class="t">${esc(t.text || "(没有文字)")}</span><span class="v">${t.views.toLocaleString()}</span><span class="m">${f ? f.emoji : ""} ${(er * 100).toFixed(1)}%</span></a>`;
      }).join("");
      box.append(list);
    }
    const foot = h("div", "fl-fans-foot");
    const mk = (txt, fn, cls) => { const b = h("button", cls || "", txt); b.type = "button"; b.addEventListener("click", fn); return b; };
    if (sum.n) foot.append(mk("导出 CSV", () => downloadCsv(`tweets-${handle}.csv`, ["id,发布时间,浏览量,互动数,互动率,开头", ...items.filter((x) => x.views >= 1).sort((a, b) => b.views - a.views).map((x) => [x.id, x.createdAt ? new Date(x.createdAt).toISOString() : "", x.views, x.inter || 0, x.views ? ((x.inter || 0) / x.views).toFixed(4) : "", x.text || ""].map(csvCell).join(","))])));
    foot.append(mk("关闭", closeFans, "ghost"));
    box.append(foot);
  }

  function flushSaveNow() { if (saveTimer) clearTimeout(saveTimer); saveTimer = null; doSave(); }

  // ---------- 账号名片(个人主页上的「生成名片」)----------
  const RESERVED = new Set(["home", "explore", "notifications", "messages", "i", "settings", "search", "compose", "login", "signup", "tos", "privacy", "intent", "share", "hashtag", "jobs", "lists", "bookmarks", "communities", "premium", "verified-orgs-signup"]);
  function profileHandle() {
    const m = location.pathname.match(/^\/([A-Za-z0-9_]{1,15})(?:\/(?:with_replies|highlights|media|articles))?\/?$/);
    return m && !RESERVED.has(m[1].toLowerCase()) ? m[1].toLowerCase() : null;
  }
  // 名片入口:一个小图标,放在个人主页头部右侧那排圆形按钮(更多、私信、编辑资料)的最左边,不占新的一行。
  // 找不到那排按钮(X 改版)时,退回放在用户名下面,仍然只是一个小图标
  const CARD_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><circle cx="9" cy="11" r="2"/><path d="M5.8 16.2c.7-1.5 1.9-2.2 3.2-2.2s2.5.7 3.2 2.2"/><path d="M14.5 10h3.5M14.5 14h2.5"/></svg>';
  function ensureCardBtn() {
    const old = document.querySelector(".fl-card-btn");
    const handle = settings.cardBtn ? profileHandle() : null;
    const un = handle && document.querySelector('[data-testid="UserName"]');
    if (!un || !users.has(handle)) { if (old) old.remove(); return; }
    const act = document.querySelector('[data-testid="userActions"], [data-testid="editProfileButton"]');
    const row = act && act.parentElement && act.parentElement.getBoundingClientRect().height ? act.parentElement : null;
    if (old && old.dataset.h === handle && old.isConnected && (row ? old.parentElement === row && row.firstElementChild === old : old.previousElementSibling === un)) return;
    if (old) old.remove();
    const b = document.createElement("button");
    b.type = "button"; b.className = "fl-card-btn" + (row ? " in-row" : ""); b.dataset.h = handle; b.setAttribute("aria-label", "生成账号名片");
    b.innerHTML = CARD_ICON;
    b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); hideTip(); openCard(handle); });
    b.addEventListener("mouseenter", () => placeTip(b, '<div class="fl-tip-h">🔍 生成账号名片</div><div class="fl-tip-n">一键生成这个账号的体检卡,可下载或复制</div>'));
    b.addEventListener("mouseleave", hideTip);
    if (row) {
      row.insertBefore(b, row.firstElementChild);
      alignCardBtn(b, act);
      setTimeout(() => alignCardBtn(b, act), 800);
      setTimeout(() => alignCardBtn(b, act), 2500);
    } else un.insertAdjacentElement("afterend", b);
  }
  // X 这一排按钮是底对齐(align-items:flex-end),每个按钮自带 margin-bottom:12px 才显得居中。
  // 照抄旁边按钮的上下外边距,再量一次中心,差多少补多少
  function alignCardBtn(b, act) {
    if (!b.isConnected || !act.isConnected) return;
    const cs = getComputedStyle(act);
    b.style.marginTop = cs.marginTop; b.style.marginBottom = cs.marginBottom;
    const ra = act.getBoundingClientRect(), rb = b.getBoundingClientRect();
    const dy = Math.round(ra.top + ra.height / 2 - (rb.top + rb.height / 2));
    if (Math.abs(dy) > 1 && Math.abs(dy) <= 24) { b.style.position = "relative"; b.style.top = `${(parseFloat(b.style.top) || 0) + dy}px`; }
  }

  function cardData(handle, avatar) {
    const u = users.get(handle), now = Date.now(), stat = stats.get(handle);
    const sc = P.qualityScore(u, stat, now);
    const doms = settings.tags.domain ? P.pickDomains(u.bio, (domScores.get(handle) || {}).s, settings.customDomains) : [];
    const all = Object.assign({}, settings, { tags: { relation: false, bigV: true, farm: true, newAcct: true, oldAcct: true, engaged: true, lowActive: true, domain: true } });
    const tags = P.tags(u, stat, now, all, { domain: doms[0] }).map((t) => t.text);
    if (doms[1]) tags.splice(1, 0, doms[1].name);
    const d = new Date(now);
    return {
      name: u.name, handle: u.handle, avatar, followers: u.followers.toLocaleString(), following: u.following.toLocaleString(),
      ratio: P.fmtRatio(P.ratioOf(u)), ageText: u.createdAt ? accountAge(u.createdAt, now).split(" · ")[1] || "—" : "—", score: sc, tags,
      date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    };
  }

  // 头像:大图(400x400)在 X 的图片服务器上第一次请求要现场缩放,有时要好几秒。
  // 所以:先等大图 3.5 秒;还没到就先用页面上已经显示着的小图(浏览器里已缓存);大图后面到了,再通过 onBetter 换上去重画
  function imgLoad(src, ms) {
    return new Promise((resolve) => {
      if (!src) return resolve(null);
      const img = new Image(); img.crossOrigin = "anonymous";
      const t = setTimeout(() => resolve(null), ms);
      img.onload = () => { clearTimeout(t); resolve(img); };
      img.onerror = () => { clearTimeout(t); resolve(null); };
      img.src = src;
    });
  }
  async function loadAvatar(handle, onBetter) {
    const u = users.get(handle);
    const cont = [...document.querySelectorAll('[data-testid^="UserAvatar-Container-"]')].find((e) => e.dataset.testid.slice(21).toLowerCase() === handle);
    const img0 = (cont && cont.querySelector("img")) || document.querySelector('a[href$="/photo"] img');
    const small = (img0 && img0.src) || (u && u.avatar) || "";
    const big = small && small.replace(/_(normal|bigger|200x200|reasonably_small|mini|x96)(\.[a-z]+)$/i, "_400x400$2");
    const bigSrc = (u && u.avatar && u.avatar.replace(/_(normal|bigger|200x200|reasonably_small|mini|x96)(\.[a-z]+)$/i, "_400x400$2")) || big;
    if (!bigSrc) return null;
    const bigP = imgLoad(bigSrc, 20000);
    const first = await Promise.race([bigP, new Promise((r) => setTimeout(() => r(null), 3500))]);
    if (first) return first;
    const fallback = small && small !== bigSrc ? await imgLoad(small, 3000) : null;
    if (fallback) { bigP.then((b) => { if (b && onBetter) onBetter(b); }); return fallback; }
    return bigP;   // 小图也没有:继续等大图(最多 20 秒)
  }

  function closeCard() { const m = document.getElementById("fl-card-modal"); if (m) m.remove(); document.removeEventListener("keydown", onCardKey, true); }
  function onCardKey(e) { if (e.key === "Escape") { e.stopPropagation(); closeCard(); } }

  async function openCard(handle) {
    closeCard();
    const m = document.createElement("div"); m.id = "fl-card-modal";
    m.innerHTML = '<div class="fl-card-box"><canvas class="fl-card-cv"></canvas><div class="fl-card-themes"></div><div class="fl-card-bar"><button data-a="dl">⬇ 下载图片</button><button data-a="cp">📋 复制图片</button><button data-a="x" class="ghost">关闭</button></div><div class="fl-card-msg"></div></div>';
    m.addEventListener("click", (e) => { if (e.target === m) closeCard(); });
    document.documentElement.append(m);
    document.addEventListener("keydown", onCardKey, true);
    const cv = m.querySelector("canvas"), msg = m.querySelector(".fl-card-msg");
    msg.textContent = "生成中…";
    let upgrade = null;
    const avatar = await loadAvatar(handle, (b) => { if (upgrade) upgrade(b); });
    if (!users.has(handle) || !m.isConnected) return;
    const cd = cardData(handle, avatar);
    let theme = "bento";
    try { theme = localStorage.getItem("fl_card_theme") || "bento"; } catch (_) {}
    if (!window.FollowerLensCard.THEMES.some(([k]) => k === theme)) theme = "bento";   // 以前存的旧风格名(极光/暗夜/纸质/年度)已经没有了
    const paint = () => {
      window.FollowerLensCard.draw(cv, cd, theme);
      m.querySelectorAll(".fl-card-themes button").forEach((b) => b.classList.toggle("on", b.dataset.t === theme));
    };
    const tb = m.querySelector(".fl-card-themes");
    for (const [k, label] of window.FollowerLensCard.THEMES) { const b = document.createElement("button"); b.dataset.t = k; b.textContent = label; tb.append(b); }
    tb.addEventListener("click", (e) => { const k = e.target.dataset && e.target.dataset.t; if (!k) return; theme = k; try { localStorage.setItem("fl_card_theme", k); } catch (_) {} paint(); });
    paint();
    upgrade = (b) => { if (!m.isConnected) return; cd.avatar = b; paint(); };   // 大图后到了:换上去重画
    msg.textContent = avatar ? "" : "头像没取到,用首字代替(不影响其它内容)";
    const blob = () => new Promise((res) => cv.toBlob(res, "image/png"));
    m.querySelector(".fl-card-bar").addEventListener("click", async (e) => {
      const a = e.target.dataset && e.target.dataset.a; if (!a) return;
      if (a === "x") return closeCard();
      try {
        const b = await blob();
        if (a === "dl") { const l = document.createElement("a"); l.href = URL.createObjectURL(b); l.download = `粉丝透镜-${handle}.png`; l.click(); setTimeout(() => URL.revokeObjectURL(l.href), 2000); msg.textContent = "已下载"; }
        else { await navigator.clipboard.write([new ClipboardItem({ "image/png": b })]); msg.textContent = "已复制,去 X 的发推框里直接粘贴"; }
      } catch (err) { msg.textContent = a === "cp" ? "复制失败,请用「下载图片」" : "保存失败:" + (err && err.message); }
    });
  }

  function cleanup() {
    document.querySelectorAll(".fl-card-btn").forEach((n) => n.remove()); closeCard();
    document.querySelectorAll(".fl-ring, .fl-ring-badge, .fl-avx").forEach((r) => r.remove());
    document.documentElement.classList.remove("fl-hide-foreign");
    document.querySelectorAll(".fl-flow").forEach((f) => f.remove());
    document.querySelectorAll(".fl-line").forEach((l) => l.remove());
    document.querySelectorAll(".fl-badge").forEach((b) => b.remove());
    document.querySelectorAll(".fl-dim").forEach((c) => c.classList.remove("fl-dim"));
    document.querySelectorAll(".fl-vip, .fl-dimreply").forEach((c) => c.classList.remove("fl-vip", "fl-dimreply"));
    document.querySelectorAll(".fl-fans-bar, .fl-fol-bar, .fl-rev-btn, .fl-notif-row").forEach((n) => n.remove()); closeFans();
    document.querySelectorAll(".fl-notif-vip").forEach((c) => c.classList.remove("fl-notif-vip"));
  }

  // 只给"屏幕附近"的推文做装饰。X 的时间线会把远处的推文也留在页面里,用户根本看不到,给它们加特效纯属浪费。
  // 用 IntersectionObserver 记下哪些推文在屏幕上下各 600px 以内;进入这个范围时再装饰。
  const near = new WeakSet();
  const watched = new WeakSet();
  const io = new IntersectionObserver((entries) => {
    let entered = false;
    for (const e of entries) {
      if (e.isIntersecting) { near.add(e.target); entered = true; }
      else { near.delete(e.target); if (!e.target.isConnected) { io.unobserve(e.target); ioVis.unobserve(e.target); } }
    }
    if (entered) scheduleRender();
  }, { rootMargin: "600px 600px 600px 600px" });   // 左右也留 600px:X Pro 是多栏横向排列,刚好在屏幕外的栏要提前装饰好

  // 第二个观察器:真正在屏幕上的才让动画跑,在屏幕外的(上下 600px 缓冲区里,已装饰好但看不到)暂停动画。
  // 用"暂停"类而不是"运行"类:这个类万一被 X 重绘冲掉,最坏结果只是多转一会儿,不会卡住不动
  const ioVis = new IntersectionObserver((entries) => {
    for (const e of entries) e.target.classList.toggle("fl-paused", !e.isIntersecting);
  });

  function nearArticles() {
    const out = [];
    for (const a of document.querySelectorAll('article[data-testid="tweet"]')) {
      if (!watched.has(a)) { watched.add(a); io.observe(a); ioVis.observe(a); }
      if (near.has(a)) out.push(a);
    }
    return out;
  }

  function render() {
    if (!settings) return;
    if (!settings.enabled) { cleanup(); return; }
    const t0 = performance.now();
    perf.renders++;
    const arts = nearArticles();
    // 先放流速标,再放粉丝徽标:头部放不下时,让粉丝徽标换行,流速标保留文字
    arts.forEach(decorateFlow);
    for (const a of arts) { const un = a.querySelector('[data-testid="User-Name"]'); if (un) decorateTweet(un); }
    arts.forEach(decorateAvatar);
    document.querySelectorAll('[data-testid="UserCell"]').forEach((cell) => {
      const nameBlock = cell.querySelector('[dir="ltr"]')?.closest("div");
      decorateCell(cell, nameBlock && nameBlock.parentElement);
    });
    markReplies(arts);
    markNotifs();
    ensureCardBtn();
    ensureReviewBtn();
    ensureFansBar();
    ensureFollowsBar();
    updateHud();
    perf.renderMs += performance.now() - t0;
  }

  let timer = null;
  function scheduleRender() {
    if (timer) return;
    timer = setTimeout(() => { timer = null; render(); }, 50);
  }

  // 只关心推文和用户行的变化。我们自己插入的东西、页面上无关区域的变动(计时器、悬停、视频进度……)一律忽略。
  const REL = 'article, [data-testid="cellInnerDiv"], [data-testid="UserCell"], [data-testid="UserName"]';
  function isOurs(n) { return n.nodeType === 1 && (n.id === "fl-tip" || n.id === "fl-hud" || n.id === "fl-card-modal" || (typeof n.className === "string" && n.className.includes("fl-"))); }
  const OURS_SEL = ".fl-badge, .fl-notif-row, .fl-fans-bar, .fl-fol-bar, .fl-rev-btn, #fl-fans-modal, .fl-flow, .fl-ring, .fl-ring-badge, .fl-line, .fl-avx, .fl-card-btn, #fl-card-modal, #fl-tip, #fl-hud";   // 明确的类名选择器,比 [class*="fl-"] 快得多
  new MutationObserver((muts) => {
    const t0 = performance.now();
    try { onMutations(muts); } finally { perf.mutMs += performance.now() - t0; perf.mutCalls++; }
  }).observe(document.documentElement, { childList: true, subtree: true });

  function onMutations(muts) {
    for (const m of muts) {
      const t = m.target;
      if (t.nodeType === 1 && t.closest && t.closest(OURS_SEL)) continue;   // 我们自己的元素里的变动
      let hit = false;
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1 || isOurs(n)) continue;
        if (n.matches(REL) || n.querySelector(REL)) { hit = true; break; }
      }
      // X 重绘推文时会把我们加的标/光环/徽标顺手删掉。只听"新增"就不知道,要等别的变动才补回来——表现就是"一会有一会没"
      if (!hit) for (const n of m.removedNodes) { if (isOurs(n) && t.isConnected) { hit = true; break; } }
      if (!hit && t.nodeType === 1 && t.closest && t.closest(REL) && [...m.addedNodes].some((n) => n.nodeType === 1 && !isOurs(n))) hit = true;   // 推文内部新长出的节点(操作栏、头像……)
      if (hit) { scheduleRender(); return; }
    }
  }

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
    const text = `FL v${(chrome.runtime.getManifest && chrome.runtime.getManifest().version) || "?"} 数据包:${msgCount} 用户:${users.size} 已显示:${shown} 插件累计耗时:${Math.round(perf.handleMs + perf.renderMs + perf.mutMs)}ms`;
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
    if (settings.tags.domain) {
      const doms = P.pickDomains(u.bio, (domScores.get(handle) || {}).s, settings.customDomains).slice(0, 2);
      rows.push(["内容方向", doms.length ? doms.map((x) => x.name).join(" · ") : `<span class="dim">还看不出来(多刷几条 TA 的推文)</span>`]);
    }
    const rel = u.followedBy && u.iFollow ? "互相关注" : u.followedBy ? "TA 关注了你" : u.iFollow ? "你关注了 TA" : "";
    if (rel) rows.push(["关系", rel]);
    const st = P.statusOf(u);
    const stLines = st.items.map((i) => `<div class="fl-tip-st l${i.level}">${i.icon} ${esc(i.text)}</div>`).join("");
    const stBlock = `<div class="fl-tip-sec">账号状态</div>` + (st.risk >= 1 ? "" : `<div class="fl-tip-st dim">没发现风险标记</div>`) + stLines;
    return `<div class="fl-tip-h">@${esc(handle)}</div>` +
      rows.map(([k, v]) => `<div class="fl-tip-r"><span>${k}</span><b>${v}</b></div>`).join("") + stBlock;
  }

  function placeTip(anchor, html) {
    if (!tip) {
      tip = document.createElement("div");
      tip.id = "fl-tip";
      document.documentElement.append(tip);
    }
    tip.innerHTML = html;
    const m = getComputedStyle(document.body).backgroundColor.match(/\d+/g) || [255, 255, 255];
    tip.dataset.theme = (+m[0] * 299 + +m[1] * 587 + +m[2] * 114) / 1000 < 128 ? "dark" : "light";
    tip.style.display = "block";
    const r = anchor.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    const left = Math.min(Math.max(8, r.left), window.innerWidth - tw - 8);
    let top = r.bottom + 6;
    if (top + th > window.innerHeight - 8) top = Math.max(8, r.top - th - 6);
    tip.style.left = left + "px";
    tip.style.top = top + "px";
  }

  function showTip(badge) {
    if (!settings || !settings.hoverCard) return;
    placeTip(badge, tipHtml(badge.dataset.flHandle));
  }
  function hideTip() { if (tip) tip.style.display = "none"; }

  window.addEventListener("scroll", hideTip, { passive: true });

  init();
})();
