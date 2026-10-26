(() => {
  const P = window.FollowerLensParse;
  const SETTINGS_KEY = "fl_settings";
  const HIST_KEY = "fl_hist";
  const DOM_KEY = "fl_dom";
  const HIST_MAX_USERS = 3000;
  const HIST_MAX_POINTS = 24;
  const HIST_MIN_GAP = 6 * 3600e3;

  const users = new Map();      // handle -> user
  const tweetSeen = new Set();  // 去重,避免同一条推文重复累计
  const stats = new Map();      // handle -> { views, interactions }
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
    storage.get([SETTINGS_KEY, HIST_KEY, DOM_KEY], (res) => {
      settings = P.mergeSettings(res && res[SETTINGS_KEY]);
      hist = (res && res[HIST_KEY]) || {};
      const saved = (res && res[DOM_KEY]) || {};
      for (const h in saved) domScores.set(h, { ts: saved[h][0], s: saved[h][1], n: Object.values(saved[h][1]).reduce((a, b) => a + b, 0) });
      applyDebug();
      flush();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes[HIST_KEY] && changes[HIST_KEY].newValue === undefined) hist = {};  // 弹窗里清除了记录
      if (changes[DOM_KEY] && changes[DOM_KEY].newValue === undefined) { domScores.clear(); scheduleRender(); }
      if (!changes[SETTINGS_KEY]) return;
      settings = P.mergeSettings(changes[SETTINGS_KEY].newValue);
      settingsVer++;
      applyDebug();
      scheduleRender();
    });
  }

  function flush() {
    while (pending.length) queue.push(pending.shift());
    if (queue.length && !draining) { draining = true; whenIdle(drain); }
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
    if (storage && Object.keys(out).length) { try { storage.set(out); } catch (_) {} }
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
  // 数据包先排队,浏览器空闲时一个一个处理:页面刚打开时 X 自己很忙,别在这时候抢主线程
  const queue = [];
  let draining = false;
  const whenIdle = (fn) => (window.requestIdleCallback ? window.requestIdleCallback(fn, { timeout: 400 }) : setTimeout(() => fn(null), 16));
  function drain(deadline) {
    do { handleMessage(queue.shift()); } while (queue.length && deadline && !deadline.didTimeout && deadline.timeRemaining() > 8);
    scheduleRender();
    if (queue.length) whenIdle(drain); else draining = false;
  }
  function enqueue(body) {
    queue.push(body);
    if (!draining) { draining = true; whenIdle(drain); }
  }

  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.source !== "follower-lens") return;
    msgCount++;
    if (!settings) { pending.push(e.data.body); return; }
    enqueue(e.data.body);
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
      // 记录观察历史(浏览量变了才追加),最多留 8 条,用来算趋势
      const prevInfo = tweetInfo.get(t.id);
      const obs = prevInfo ? prevInfo.obs : [];
      if (!obs.length || obs[obs.length - 1].views !== t.views) {
        obs.push({ views: t.views, at: Date.now() });
        if (obs.length > 8) obs.shift();
      }
      tweetInfo.set(t.id, { views: t.views, createdAt: t.createdAt, author: t.author, obs });
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
    const d = domScores.get(handle);
    return [u.followers, s ? s.views : 0, u.followedBy, u.iFollow, settingsVer, compact ? 1 : 0, d ? d.n : 0].join("|");
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

  // 别的插件(比如 SoPilot)会在 article 下挂绝对定位的浮层,压在头部右侧。
  // 返回这些与头部这一行重叠的浮层(不含我们自己的)。
  function headerOverlays(article, row) {
    const rowRect = row.getBoundingClientRect();
    const out = [];
    for (const el of article.children) {
      if (el.contains(row) || isOurs(el)) continue;       // 自己的元素(比如上一次放的角落标)不算"别人的浮层"
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

  // 名字和 @ID 内容最右边的位置(用来判断角落的标会不会压住它们)
  function contentRight(un) {
    let r = 0;
    for (const k of un.children) { if (k.classList && k.classList.contains("fl-badge")) continue; r = Math.max(r, k.getBoundingClientRect().right); }
    return r;
  }

  // 固定在标题行右上角:坐标与常见插件的流速标一致(距右 96px、距顶 10px)。
  // 那个位置已有别的插件的标时,宽高对齐它、层级比它高 1,把它完整盖住;没有就用默认值。
  function placeCorner(chip, article, row) {
    const others = [...article.children].filter((el) => el !== chip && !isOurs(el) && getComputedStyle(el).position === "absolute" && el.getBoundingClientRect().width > 0 && (() => {
      const r = el.getBoundingClientRect(), rr = row.getBoundingClientRect();
      return r.bottom > rr.top && r.top < rr.bottom && r.right > rr.left && r.left < rr.right;
    })());
    let right = 96, top = 10, minW = 0, minH = 0, z = 30;
    if (others.length) {
      const ar = article.getBoundingClientRect(), o = others[0], r = o.getBoundingClientRect();
      right = Math.round(ar.right - r.right); top = Math.round(r.top - ar.top); minW = Math.round(r.width); minH = Math.round(r.height);
      z = (parseInt(getComputedStyle(o).zIndex, 10) || 0) + 1;
    }
    const st = chip.style;
    const want = { position: "absolute", right: right + "px", top: top + "px", zIndex: String(z), minWidth: minW + "px", minHeight: minH + "px", textAlign: "center", boxSizing: "border-box" };
    for (const k in want) if (st[k] !== want[k]) st[k] = want[k];
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

  const fmtAge = (h) => (h < 1 ? Math.round(h * 60) + " 分钟" : h.toFixed(1) + " 小时");

  const flowRechecked = new WeakSet();   // 每条推文只在放好后复查一次位置(别的插件的浮层可能晚到)

  function decorateFlow(article) {
    const old = article.querySelector(".fl-flow");
    const id = tweetIdOf(article);
    const info = id && tweetInfo.get(id);
    const author = info && users.get(info.author);
    const flow = settings.flow && info ? P.flowOf(info, author ? author.followers : 0, Date.now(), settings.flowMode) : null;
    flowTier.set(article, flow ? flow.tier : -1);
    if (!flow) { if (old) old.remove(); return; }

    const trend = P.trendOf(info.obs, flow.rate);
    const arrow = trend ? (trend.dir === "up" ? " ↗" : trend.dir === "down" ? " ↘" : "") : "";
    // 稳态快路径:内容没变就直接返回,不读任何布局(getComputedStyle / getBoundingClientRect 会强制同步重排,是最大的开销)
    const sig0 = `${P.fmtRate(flow.rate)}|${flow.tier}|${arrow}|${settingsVer}`;
    if (old && old.isConnected && old.dataset.flSig0 === sig0) return;

    const un = article.querySelector('[data-testid="User-Name"]');
    const link = article.querySelector('[role="group"] a[href$="/analytics"]');
    // 位置:corner = 固定在标题行右上角,和常见插件的流速标同一个位置(盖在它上面,不改它);
    //       auto = 头部右侧没被占就放头部,否则放底部;header / bar = 固定头部 / 底部
    const row = un && headerRow(un);
    const menu = row && row.lastElementChild;
    const headerOk = !!menu && !menu.classList.contains("fl-flow");
    const cell = link && link.parentElement;
    const mode = settings.flowPos;
    const cornerOk = mode === "corner" && getComputedStyle(article).position !== "static";
    const overlaid = headerOk && headerOverlays(article, row).length > 0;
    let place = cornerOk ? "c" : headerOk && (mode === "header" || (mode === "auto" && !overlaid) || (mode === "corner" && !cornerOk)) ? "h" : cell ? "b" : headerOk ? "h" : "";
    if (!place) { if (old) old.remove(); return; }
    const inHeader = place === "h";

    if (old) old.remove();

    const rate = `${P.fmtRate(flow.rate)}/h`;
    const chip = document.createElement("span");
    chip.className = `fl-flow f${flow.tier}` + (place === "h" ? " fl-flow-h" : place === "c" ? " fl-flow-c" : "") + (settings.flowFx && flow.tier >= 3 ? " fl-fx" : "");
    chip.dataset.flSig0 = sig0;
    const lines = [`流速 ${flow.name}${settings.flowMode === "rel" ? "(按粉丝量折算)" : ""}`,
      `平均约 ${Math.round(flow.rate).toLocaleString()} 次浏览/小时(发布 ${fmtAge(flow.ageH)})`];
    if (trend) lines.push(`最近这一阵约 ${Math.round(trend.recent).toLocaleString()} 次/小时,${trend.dir === "up" ? "比平均快,在升温 ↗" : trend.dir === "down" ? "比平均慢,在降温 ↘" : "和平均差不多"}`);
    chip.title = lines.join("\n");

    // 从详细到简略,放得下哪个就用哪个
    const levels = place !== "b"
      ? [`${flow.emoji} ${flow.name} ${rate}${arrow}`, `${flow.emoji} ${rate}${arrow}`, `${flow.emoji}${arrow}`]
      : [`${flow.emoji} ${rate}${arrow}`, `${flow.emoji}${arrow}`];
    if (place === "c") {
      chip.style.setProperty("--fl-bg", pageBg());
      article.append(chip);
      placeCorner(chip, article, row);
      // 从详细到简略,选不压住名字和 @ID 的最详细一档
      const cr = contentRight(un);
      let fitted = false;
      for (const t of levels) { setChip(chip, t, flow.emoji); placeCorner(chip, article, row); if (chip.getBoundingClientRect().left >= cr + 6) { fitted = true; break; } }
      // 连图标都会压住名字:改放到底部浏览量旁
      if (!fitted && cell) {
        chip.remove(); chip.classList.remove("fl-flow-c"); chip.removeAttribute("style");
        cell.append(chip);
        for (const t of levels.slice(1)) { setChip(chip, t, flow.emoji); if (cell.scrollWidth <= cell.clientWidth + 1) break; }
      }
    } else if (inHeader) {
      // 先撤下这条推文已有的粉丝徽标,等流速标就位后,render 会按"放得下行内、放不下换行"重新放
      const rec = placed.get(un);
      if (rec) { rec.badge.remove(); if (rec.line) rec.line.remove(); placed.delete(un); }
      menu.before(chip);
      for (const t of levels) { setChip(chip, t, flow.emoji); if (!crowded(un, chip)) break; }
      if (mode === "header") avoidOverlays(chip, article, row, menu);
    } else {
      cell.append(chip);
      for (const t of levels) { setChip(chip, t, flow.emoji); if (cell.scrollWidth <= cell.clientWidth + 1) break; }
    }
    // 别的插件的浮层可能比我们晚到:放好 1.5 秒后复查一次位置(只一次),之后不再碰布局
    if (!flowRechecked.has(article)) {
      flowRechecked.add(article);
      setTimeout(() => {
        const c2 = article.querySelector(".fl-flow");
        if (c2 && c2.isConnected) { c2.dataset.flSig0 = ""; scheduleRender(); }
      }, 1500);
    }
  }

  // ----- 趣味模式:按这条推文的流速,给作者头像外面叠一圈光环(🚲 以下不加,免得太吵)-----
  function isRound(container) {
    // 个人头像是圆的,企业号头像是方的:往上找带大圆角的祖先
    for (let e = container.querySelector("img"); e && e !== container.parentElement; e = e.parentElement) {
      const r = getComputedStyle(e).borderRadius;
      if (r === "9999px" || r.includes("%")) return true;
    }
    return false;
  }

  function decorateAvatar(article) {
    const container = article.querySelector('[data-testid^="UserAvatar-Container-"]');
    if (!container) return;
    const tier = flowTier.get(article);
    const want = settings.avatarFx && tier >= 2 ? tier : -1;
    const ring = container.querySelector(":scope > .fl-ring");
    if (want < 0) { if (ring) { ring.remove(); container.querySelector(":scope > .fl-ring-badge")?.remove(); } return; }
    if (ring && ring.dataset.flTier === String(want)) return;   // 稳态:档位没变就直接返回(isRound 要读样式,只在创建时算)
    const round = isRound(container);
    const sig = String(want);
    if (ring) { ring.remove(); container.querySelector(":scope > .fl-ring-badge")?.remove(); }
    const el = document.createElement("span");
    el.className = `fl-ring r${want}` + (round ? " round" : " square");
    el.dataset.flTier = sig;
    container.append(el);
    if (want >= 3) {
      const b = document.createElement("span");
      b.className = "fl-ring-badge";
      b.textContent = want === 4 ? "⚡" : "🚀";
      container.append(b);
    }
  }

  function cleanup() {
    document.querySelectorAll(".fl-ring, .fl-ring-badge").forEach((r) => r.remove());
    document.querySelectorAll(".fl-flow").forEach((f) => f.remove());
    document.querySelectorAll(".fl-line").forEach((l) => l.remove());
    document.querySelectorAll(".fl-badge").forEach((b) => b.remove());
    document.querySelectorAll(".fl-dim").forEach((c) => c.classList.remove("fl-dim"));
  }

  function render() {
    if (!settings) return;
    if (!settings.enabled) { cleanup(); return; }
    // 先放流速标,再放粉丝徽标:头部放不下时,让粉丝徽标换行,流速标保留文字
    document.querySelectorAll('article[data-testid="tweet"]').forEach(decorateFlow);
    document.querySelectorAll('article[data-testid="tweet"] [data-testid="User-Name"]').forEach(decorateTweet);
    document.querySelectorAll('article[data-testid="tweet"]').forEach(decorateAvatar);
    document.querySelectorAll('[data-testid="UserCell"]').forEach((cell) => {
      const nameBlock = cell.querySelector('[dir="ltr"]')?.closest("div");
      decorateCell(cell, nameBlock && nameBlock.parentElement);
    });
    updateHud();
  }

  let timer = null;
  function scheduleRender() {
    if (timer) return;
    timer = setTimeout(() => { timer = null; render(); }, 200);
  }

  // 只关心推文和用户行的变化。我们自己插入的东西、页面上无关区域的变动(计时器、悬停、视频进度……)一律忽略。
  const REL = 'article, [data-testid="cellInnerDiv"], [data-testid="UserCell"]';
  function isOurs(n) { return n.nodeType === 1 && (n.id === "fl-tip" || n.id === "fl-hud" || (typeof n.className === "string" && n.className.includes("fl-"))); }
  new MutationObserver((muts) => {
    for (const m of muts) {
      const t = m.target;
      if (t.nodeType === 1 && t.closest && t.closest('[class*="fl-"], #fl-tip, #fl-hud')) continue;   // 我们自己的元素里的变动
      let hit = false;
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1 || isOurs(n)) continue;
        if (n.matches(REL) || n.querySelector(REL)) { hit = true; break; }
      }
      if (!hit && t.nodeType === 1 && t.closest && t.closest(REL) && [...m.addedNodes].some((n) => n.nodeType === 1 && !isOurs(n))) hit = true;   // 推文内部新长出的节点(操作栏、头像……)
      if (hit) { scheduleRender(); return; }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

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
    if (settings.tags.domain) {
      const doms = P.pickDomains(u.bio, (domScores.get(handle) || {}).s, settings.customDomains).slice(0, 2);
      rows.push(["内容方向", doms.length ? doms.map((x) => x.name).join(" · ") : `<span class="dim">还看不出来(多刷几条 TA 的推文)</span>`]);
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

  window.addEventListener("scroll", hideTip, { passive: true });

  init();
})();
