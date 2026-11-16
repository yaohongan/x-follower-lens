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

  // 接口名(URL 里 /graphql/<哈希>/<接口名>)一起传过去:内容脚本靠它认出"粉丝列表"这种响应
  const opOf = (url) => { const m = /\/graphql\/[^/]+\/([A-Za-z0-9_]+)/.exec(url); return m ? m[1] : ""; };
  const emit = (text, url) => {
    if (relevant(text)) window.postMessage({ source: SOURCE, body: text, op: opOf(url) }, "*");
  };

  // 列表接口(粉丝 / 认证粉丝 / 正在关注)的限流信息:X 每 15 分钟只给 50 次。内容脚本靠它知道还剩几次、什么时候恢复,不会把额度烧光。
  // 只传四个数字(上限、剩余、恢复时间、状态码)
  const isListOp = (url) => /\/graphql\/[^/]+\/(?:BlueVerifiedFollowers|Followers|Following)(?:\?|$)/.test(url);
  const emitRl = (url, status, hdr) => {
    try {
      const rem = hdr("x-rate-limit-remaining");
      if (rem === null || rem === undefined) return;
      window.postMessage({ source: SOURCE, rl: { op: opOf(url), status, limit: Number(hdr("x-rate-limit-limit")), remaining: Number(rem), reset: Number(hdr("x-rate-limit-reset")) } }, "*");
    } catch (_) {}
  };

  // 实验:只在「原创内容奖励」页和「账号分析」页上,把和曝光/奖励有关的响应原样发给内容脚本,存在本地,供排查(这两页用的是 X 的另一套接口)
  const onDiagPage = () => /^\/i\/(?:jf\/creators|account_analytics)/.test(location.pathname);
  const diagUrl = (url) => typeof url === "string" && (url.includes("/i/api/") || url.includes("api.x.com/")) && !/\.(?:png|jpe?g|gif|webp|css|js)(?:\?|$)/.test(url);
  const emitDiag = (text, url, status) => {
    if (typeof text !== "string" || text.length < 80 || text.length > 4e6) return;
    if (!/impression|reward|creator|monetiz|eligib|verified_home|analytics|revenue/i.test(text)) return;
    window.postMessage({ source: SOURCE, dx: { url: String(url).replace(/\?.*$/, "").slice(0, 160), status, body: text.slice(0, 60000), at: Date.now() } }, "*");
  };

  // 账号分析页的「每日曝光」查询:整体曝光、蓝 V 曝光都在里面。只认这一个接口,响应里有 current_time_series 才转发
  const isAO = (url) => typeof url === "string" && /\/graphql\/[^/]+\/accountOverviewDailyQuery(?:\?|$)/.test(url);
  const emitAO = (t) => { if (typeof t === "string" && t.includes("current_time_series") && t.length < 8e6) window.postMessage({ source: SOURCE, ao: t }, "*"); };

  const origFetch = window.fetch;
  window.fetch = function (...args) {
    const p = origFetch.apply(this, args);               // X 拿到的就是它自己的 Promise,不多等任何东西
    try {
      const url = typeof args[0] === "string" ? args[0] : args[0] && args[0].url;
      if (isAO(url)) p.then((res) => { try { res.clone().text().then(emitAO).catch(() => {}); } catch (_) {} }, () => {});
      if (onDiagPage() && diagUrl(url)) p.then((res) => { try { res.clone().text().then((t) => emitDiag(t, url, res.status)).catch(() => {}); } catch (_) {} }, () => {});
      if (wanted(url)) p.then((res) => {
        try { res.clone().text().then((t) => emit(t, url)).catch(() => {}); } catch (_) {}
        if (isListOp(url)) emitRl(url, res.status, (k) => res.headers.get(k));
      }, () => {});
    } catch (_) {}
    return p;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    if (isAO(url)) this.addEventListener("load", () => { try { if (this.responseType === "" || this.responseType === "text") emitAO(this.responseText); } catch (_) {} });
    if (onDiagPage() && diagUrl(url)) this.addEventListener("load", () => { try { if (this.responseType === "" || this.responseType === "text") emitDiag(this.responseText, url, this.status); } catch (_) {} });
    if (wanted(url)) {
      this.addEventListener("load", () => {
        try { emit(this.responseText, url); } catch (_) {}
        if (isListOp(url)) emitRl(url, this.status, (k) => this.getResponseHeader(k));
      });
    }
    return origOpen.call(this, method, url, ...rest);
  };
})();
