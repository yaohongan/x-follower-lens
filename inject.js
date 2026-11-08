// 运行在页面主世界:只读 X 自己发出的 GraphQL 响应,不主动发任何请求。
// 对 X 自己的请求尽量不添乱:
//   1. 只给"可能带粉丝数"的接口挂钩(时间线、推文、搜索、关注列表、用户资料……),通知数、私信设置这类直接放过
//   2. fetch 不包成 async 函数(那会让 X 的每个请求多等一个微任务),直接把原来的 Promise 还给 X
//   3. 响应里没有粉丝数就丢掉,不传给内容脚本(原生字符串查找,很快)
(() => {
  const SOURCE = "follower-lens";
  const isGraphql = (url) => typeof url === "string" && url.includes("/i/api/graphql/");
  // 接口名(URL 里 /graphql/<哈希>/<接口名>)里带这些词的才可能有用户/推文数据
  const WANT = /\/graphql\/[^/]+\/[A-Za-z]*(?:Timeline|Tweet|Search|Follow|User|List|Bookmark|Like|Notification|Communit|Explore|Retweeter|Favoriter|Conversation|Thread|Profile|Trend|Topic|Article|Mute|Block|Home|Recommend|Sidebar|Page|Quote|Space)/i;
  const relevant = (text) => typeof text === "string" && (text.includes('"relationship_counts"') || text.includes('"followers_count"'));
  const wanted = (url) => isGraphql(url) && WANT.test(url);

  const emit = (text, requestUrl, pagePath, requestAt) => {
    if (relevant(text)) window.postMessage({ source: SOURCE, body: text }, "*");
    // Keep the request-time URL/path: a delayed response after SPA navigation
    // must not be attributed to the account currently visible on screen.
    if (/\/graphql\/[^/]+\/Followers(?:\?|$)/.test(requestUrl || "")) {
      window.postMessage({ source: "follower-lens-audience", body: text, requestUrl, pagePath, requestAt }, "*");
    }
  };

  const origFetch = window.fetch;
  window.fetch = function (...args) {
    const p = origFetch.apply(this, args);               // X 拿到的就是它自己的 Promise,不多等任何东西
    try {
      const input = args[0];
      const url = typeof input === "string" ? new URL(input, location.href).href : input instanceof URL ? input.href : input && input.url;
      const pagePath = location.pathname;
      const requestAt = Date.now();
      if (wanted(url)) p.then((res) => { try { res.clone().text().then((text) => emit(text, url, pagePath, requestAt)).catch(() => {}); } catch (_) {} }, () => {});
    } catch (_) {}
    return p;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  const xhrContext = new WeakMap();
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    if (!xhrContext.has(this)) {
      this.addEventListener("load", () => {
        const context = xhrContext.get(this);
        if (context) { try { emit(this.responseText, context.url, context.pagePath, context.requestAt); } catch (_) {} }
      });
    }
    let resolved;
    try { resolved = new URL(String(url), location.href).href; } catch (_) {}
    xhrContext.set(this, wanted(resolved) ? { url: resolved, pagePath: location.pathname, requestAt: Date.now() } : null);
    return origOpen.call(this, method, url, ...rest);
  };
})();
