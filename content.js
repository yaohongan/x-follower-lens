(() => {
  const { extract, tags } = window.FollowerLensParse;
  const users = new Map();      // handle -> user
  const tweetSeen = new Set();  // 去重,避免同一条推文重复累计
  const stats = new Map();      // handle -> { views, interactions }
  let msgCount = 0;

  console.log("[FL] content.js 已加载");

  const hud = document.createElement("div");
  hud.id = "fl-hud";
  document.documentElement.append(hud);
  const updateHud = () => {
    const shown = document.querySelectorAll(".fl-badge").length;
    const text = `FL 数据包:${msgCount} 用户:${users.size} 已显示:${shown}`;
    if (hud.textContent !== text) hud.textContent = text;
  };
  updateHud();

  // 1 万以内显示精确值,以上用"万"
  const fmt = (n) => {
    if (n < 10000) return String(n);
    if (n < 1e8) return (n / 1e4).toFixed(n < 1e5 ? 2 : 1).replace(/\.?0+$/, "") + "万";
    return (n / 1e8).toFixed(2).replace(/\.?0+$/, "") + "亿";
  };

  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.source !== "follower-lens") return;
    msgCount++;
    let json;
    try { json = JSON.parse(e.data.body); } catch (_) { return; }
    const { users: us, tweets } = extract(json);
    for (const u of us) users.set(u.handle, u);
    for (const t of tweets) {
      if (tweetSeen.has(t.id)) continue;
      tweetSeen.add(t.id);
      const s = stats.get(t.author) || { views: 0, interactions: 0 };
      s.views += t.views;
      s.interactions += t.interactions;
      stats.set(t.author, s);
    }
    scheduleRender();
    updateHud();
  });

  function handleOf(container) {
    for (const a of container.querySelectorAll('a[role="link"][href^="/"]')) {
      const m = a.getAttribute("href").match(/^\/([A-Za-z0-9_]{1,15})$/);
      if (m && a.textContent.trim().startsWith("@")) return m[1].toLowerCase();
    }
    return null;
  }

  function buildBadge(handle) {
    const u = users.get(handle);
    if (!u) return null;
    const stat = stats.get(handle);
    const wrap = document.createElement("span");
    wrap.className = "fl-badge";
    wrap.dataset.flHandle = handle;
    wrap.dataset.flSig = `${u.followers}|${stat ? stat.views : 0}`;

    const main = document.createElement("span");
    main.className = "fl-main";
    main.textContent = `${fmt(u.followers)} 粉丝`;
    const ratio = u.following > 0 ? u.followers / u.following : u.followers;
    main.title = `关注 ${u.following} · 粉丝/关注比 ${ratio >= 10 ? ratio.toFixed(0) : ratio.toFixed(1)}`;
    wrap.append(main);

    for (const t of tags(u, stat, Date.now())) {
      const el = document.createElement("span");
      el.className = "fl-tag " + t.cls;
      el.textContent = t.text;
      wrap.append(el);
    }
    return wrap;
  }

  function decorate(container, anchor) {
    const handle = handleOf(container);
    if (!handle || !users.has(handle)) return;
    const old = container.querySelector(".fl-badge");
    const u = users.get(handle), stat = stats.get(handle);
    const sig = `${u.followers}|${stat ? stat.views : 0}`;
    if (old && old.dataset.flHandle === handle && old.dataset.flSig === sig) return;
    if (old) old.remove();
    const badge = buildBadge(handle);
    if (badge && anchor) anchor.append(badge);
  }

  function render() {
    document.querySelectorAll('article[data-testid="tweet"] [data-testid="User-Name"]').forEach((el) => {
      decorate(el, el);
    });
    document.querySelectorAll('[data-testid="UserCell"]').forEach((cell) => {
      const nameBlock = cell.querySelector('[dir="ltr"]')?.closest("div");
      decorate(cell, nameBlock && nameBlock.parentElement);
    });
  }

  let timer = null;
  function scheduleRender() {
    if (timer) return;
    timer = setTimeout(() => { timer = null; render(); updateHud(); }, 150);
  }

  new MutationObserver(scheduleRender).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();
