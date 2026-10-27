(() => {
  const P = window.FollowerLensParse;
  const SETTINGS_KEY = "fl_settings";
  const HIST_KEY = "fl_hist";
  const DOM_KEY = "fl_dom";
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
      applyDebug(); applyHtml();
      flush();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes[HIST_KEY] && changes[HIST_KEY].newValue === undefined) hist = {};  // 弹窗里清除了记录
      if (changes[DOM_KEY] && changes[DOM_KEY].newValue === undefined) { domScores.clear(); scheduleRender(); }
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
  // 数据包排队,分片处理:每次最多占 12ms 就让出主线程(不卡页面),但不等"空闲"
  // (空闲回调在页面刚打开最忙的时候会被饿很久,标就出来得慢)
  const queue = [];
  let draining = false;
  function drain() {
    const t0 = performance.now();
    do { handleMessage(queue.shift()); } while (queue.length && performance.now() - t0 < 12);
    scheduleRender();
    if (queue.length) setTimeout(drain, 0); else draining = false;
  }
  function enqueue(body) {
    // 总开关关着:数据包直接丢掉,不解析、不记录历史、不排队。这样关掉总开关就能干净地对比"有没有这个插件"
    if (!settings.enabled) return;
    queue.push(body);
    if (!draining) { draining = true; setTimeout(drain, 0); }
  }

  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.source !== "follower-lens") return;
    msgCount++;
    if (!settings) { pending.push(e.data.body); return; }
    enqueue(e.data.body);
  });

  function handleMessage(body) {
    const t0 = performance.now();
    perf.packets++; perf.bytes += body.length;
    try { handleMessageInner(body); } finally { perf.handleMs += performance.now() - t0; }
  }

  function handleMessageInner(body) {
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
  // 圈内档按倍数再分:≥0.3× 写全(快出圈了);0.1–0.3× 只写倍数;<0.1× 只留图标,不吵
  function flowLevels(place, d, arrow) {
    if (d.lite === 2) return [{ t: `${d.emoji}${arrow}` }, { t: d.emoji }];
    if (d.lite === 1) return [{ t: `${d.emoji} ${d.text}${arrow}` }, { t: `${d.emoji}${arrow}` }, { t: d.emoji }];
    const full = `${d.emoji} ${d.name} ${d.text}${arrow}`;
    return place !== "b"
      ? [{ t: full }, { t: `${d.emoji} ${d.text}${arrow}` }, { t: `${d.emoji}${arrow}` }]
      : [{ t: `${d.emoji} ${d.text}${arrow}` }, { t: `${d.emoji}${arrow}` }, { t: d.emoji }];
  }

  // 悬停信息卡:鼠标放到流速标、头像上的小图标时,立刻显示这条推文的流速信息(不用等浏览器原生提示的 1 秒延迟)
  function flowCardHtml(d) {
    const { flow, trend, views, rc, disp, hot, followers } = d;
    const MOOD = ["还在粉丝圈里", "刚刚冒出圈", "已经传到圈外", "越传越广", "传遍全网"];
    const rows = [];
    if (rc) rows.push(["破圈倍数", `<b>${rc.text}</b> 的粉丝量`]);
    rows.push(["累计被看", Number(views).toLocaleString() + " 次"]);
    if (rc) rows.push(["作者粉丝", Number(followers).toLocaleString()]);
    rows.push(["已发出", fmtAge(flow.ageH)]);
    rows.push(["平均每小时被看", Math.round(flow.rate).toLocaleString() + " 次"]);
    if (trend) rows.push(["近段走势", `约 ${Math.round(trend.recent).toLocaleString()} 次/小时 ${trend.dir === "up" ? '<span class="up">↗ 越传越快</span>' : trend.dir === "down" ? '<span class="down">↘ 慢下来了</span>' : "和全程差不多"}`]);
    const scale = rc ? `<div class="fl-tip-r"><span>圈子刻度</span><b style="font-weight:400;font-size:11.5px">🫧&lt;1× 🌀&lt;3× 🌊&lt;10× 🔥&lt;50× 🌍≥50×</b></div>` : "";
    const notes = [
      rc && rc.lv === 0 && rc.x >= 0.3 ? "快到 1 倍了,再涨一点就出圈" : "",
      rc ? "破圈倍数 = 累计被看 ÷ 作者粉丝数" : "拿不到作者粉丝数,算不了破圈倍数,先显示浏览量",
      hot ? "6 小时内就到了 3 倍以上,还在往外传" : "",
      flow.fresh ? "刚发出来,数字还会变" : flow.old ? "发出已久,这是整段时间的累计" : "",
    ].filter(Boolean);
    return `<div class="fl-tip-h">${disp.emoji} ${disp.name} · ${rc ? MOOD[rc.lv] : "暂无粉丝数"}</div>` + rows.map(([k, v]) => `<div class="fl-tip-r"><span>${k}</span><b>${v}</b></div>`).join("") + scale + notes.map((n) => `<div class="fl-tip-n">${n}</div>`).join("");
  }

  function bindFlowHover(el, article) {
    if (el.dataset.flHover) return;
    el.dataset.flHover = "1";
    el.addEventListener("mouseenter", () => { const d = flowCardData.get(article); if (d && settings.hoverCard) placeTip(el, flowCardHtml(d)); });
    el.addEventListener("mouseleave", hideTip);
  }

  // 贴靠:流速标放在头部时,让它的右边缘紧贴头部右边"看得见的"按钮(Grok、菜单)。
  // 不依赖 X 的容器结构:直接量按钮的实际位置,再用相对偏移(position:relative; left)挪过去。相对偏移不影响布局。
  // 注意要跳过 visibility:hidden 的按钮:被我们隐藏的别家流速标仍然占着位置,不能拿它当对齐目标。
  // X 的头部按钮是陆续渲染出来的,所以放好之后还会再量几次。
  function snapRight(chip) {
    if (!chip || !chip.isConnected || chip.dataset.flPlace === "b") return;
    if (settings.flowPos === "header" && !settings.hideForeign) return;   // 这个模式要让到别家流速标的左边,由 avoidOverlays 负责
    const art = chip.closest("article");
    const un = art && art.querySelector('[data-testid="User-Name"]');
    if (!un) return;
    const ur = un.getBoundingClientRect(), cr = chip.getBoundingClientRect();
    let L = Infinity;
    for (const b of art.querySelectorAll('button, [role="button"]')) {
      if (chip.contains(b) || un.contains(b)) continue;
      const r = b.getBoundingClientRect();
      if (!r.width || !r.height || r.top < ur.top - 12 || r.top > ur.bottom + 4 || r.left <= ur.left + 60) continue;
      if (r.left >= L) continue;
      const cs = getComputedStyle(b);
      if (cs.visibility === "hidden" || cs.opacity === "0" || cs.display === "none") continue;
      L = r.left;
    }
    if (L === Infinity) return;
    let delta = Math.round(L - 8 - cr.right);
    if (Math.abs(delta) <= 3 || delta > 900 || delta < -900) return;
    if (cr.left + delta < ur.right + 4) delta = Math.round(ur.right + 4 - cr.left);   // 绝不压到名字
    if (Math.abs(delta) <= 3) return;
    chip.style.position = "relative";
    chip.style.left = `${(parseFloat(chip.style.left) || 0) + delta}px`;
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
    // 标上显示破圈倍数;拿不到作者粉丝数时退回显示浏览量。6 小时内就到 3 倍以上算"还在往外传",没有趋势箭头时补一个 ↗
    const rc = author && P.reachOf(info.views, author.followers);
    const hot = !!rc && !flow.old && flow.ageH < 6 && rc.x >= 3;
    const disp = rc ? { tier: rc.lv, emoji: rc.emoji, name: rc.name, text: rc.text, lite: rc.lv === 0 ? (rc.x < 0.1 ? 2 : rc.x < 0.3 ? 1 : 0) : 0 } : { tier: 0, emoji: "👁", name: "浏览", text: P.fmt(info.views) };
    flowTier.set(article, disp.tier);
    const arrow = trend ? (trend.dir === "up" ? " ↗" : trend.dir === "down" ? " ↘" : "") : hot ? " ↗" : "";
    // key = 结构(档位 + 设置);sig0 = 结构 + 数字。
    // 稳态快路径:什么都没变,直接返回,不读任何布局(getComputedStyle / getBoundingClientRect 会强制同步重排)
    const key = `${disp.tier}|${disp.lite || 0}|${settingsVer}`;
    const sig0 = `${key}|${disp.text}|${arrow}`;
    if (old && old.isConnected && old.dataset.flSig0 === sig0) return;
    flowCardData.set(article, { flow, trend, views: info.views, rc, disp, hot, followers: author ? author.followers : 0 });
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
  const AV_EMOJI = ["🫧", "🌀", "🌊", "🔥", "🌍"];
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
      container.addEventListener("mouseenter", () => { const d = flowCardData.get(article); if (d && settings.hoverCard) placeTip(container, flowCardHtml(d)); });
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
    if (want >= 3 && !round) container.append(mk("fl-ring-badge", want === 4 ? "🌍" : "🔥"));
    buildAvatarFx(container, want, round, article);
  }


  // ---------- 账号名片(个人主页上的「生成名片」)----------
  const RESERVED = new Set(["home", "explore", "notifications", "messages", "i", "settings", "search", "compose", "login", "signup", "tos", "privacy", "intent", "share", "hashtag", "jobs", "lists", "bookmarks", "communities", "premium", "verified-orgs-signup"]);
  function profileHandle() {
    const m = location.pathname.match(/^\/([A-Za-z0-9_]{1,15})(?:\/(?:with_replies|highlights|media|articles))?\/?$/);
    return m && !RESERVED.has(m[1].toLowerCase()) ? m[1].toLowerCase() : null;
  }
  function ensureCardBtn() {
    const old = document.querySelector(".fl-card-btn");
    const handle = settings.cardBtn ? profileHandle() : null;
    const un = handle && document.querySelector('[data-testid="UserName"]');
    if (!un || !users.has(handle)) { if (old) old.remove(); return; }
    if (old && old.dataset.h === handle && old.isConnected && old.previousElementSibling === un) return;
    if (old) old.remove();
    const b = document.createElement("button");
    b.type = "button"; b.className = "fl-card-btn"; b.dataset.h = handle; b.textContent = "🔍 生成账号名片";
    b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); openCard(handle); });
    un.insertAdjacentElement("afterend", b);
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

  function loadAvatar(handle) {
    return new Promise((resolve) => {
      const u = users.get(handle);
      let src = u && u.avatar;
      if (!src) {   // 接口数据里没有:退回页面上的头像(用户名大小写不敏感地找)
        const cont = [...document.querySelectorAll('[data-testid^="UserAvatar-Container-"]')].find((e) => e.dataset.testid.slice(20).toLowerCase() === handle);
        const img0 = (cont && cont.querySelector("img")) || document.querySelector('a[href$="/photo"] img');
        src = img0 && img0.src;
      }
      src = src && src.replace(/_(normal|bigger|200x200|reasonably_small|mini)(\.[a-z]+)$/i, "_400x400$2");
      if (!src) return resolve(null);
      const img = new Image(); img.crossOrigin = "anonymous";
      const t = setTimeout(() => resolve(null), 6000);
      img.onload = () => { clearTimeout(t); resolve(img); };
      img.onerror = () => { clearTimeout(t); resolve(null); };
      img.src = src;
    });
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
    const avatar = await loadAvatar(handle);
    if (!users.has(handle) || !m.isConnected) return;
    const cd = cardData(handle, avatar);
    let theme = "aurora";
    try { theme = localStorage.getItem("fl_card_theme") || "aurora"; } catch (_) {}
    const paint = () => {
      window.FollowerLensCard.draw(cv, cd, theme);
      m.querySelectorAll(".fl-card-themes button").forEach((b) => b.classList.toggle("on", b.dataset.t === theme));
    };
    const tb = m.querySelector(".fl-card-themes");
    for (const [k, label] of window.FollowerLensCard.THEMES) { const b = document.createElement("button"); b.dataset.t = k; b.textContent = label; tb.append(b); }
    tb.addEventListener("click", (e) => { const k = e.target.dataset && e.target.dataset.t; if (!k) return; theme = k; try { localStorage.setItem("fl_card_theme", k); } catch (_) {} paint(); });
    paint();
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
  }, { rootMargin: "600px 0px 600px 0px" });

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
    ensureCardBtn();
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
  const OURS_SEL = ".fl-badge, .fl-flow, .fl-ring, .fl-ring-badge, .fl-line, .fl-avx, .fl-card-btn, #fl-card-modal, #fl-tip, #fl-hud";   // 明确的类名选择器,比 [class*="fl-"] 快得多
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
    return `<div class="fl-tip-h">@${esc(handle)}</div>` +
      rows.map(([k, v]) => `<div class="fl-tip-r"><span>${k}</span><b>${v}</b></div>`).join("");
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
