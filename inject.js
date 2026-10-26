// 运行在页面主世界:只读 X 自己发出的 GraphQL 响应,不主动发任何请求。
// 只转发"里面带粉丝数"的响应(时间线、关注列表、用户资料等);通知数、私信设置这类无关响应直接丢掉,
// 省掉跨世界传输和 JSON 解析的开销。判断用的是原生字符串查找,很快。
(() => {
  const SOURCE = "follower-lens";
  const isGraphql = (url) => typeof url === "string" && url.includes("/i/api/graphql/");
  const relevant = (text) => typeof text === "string" && (text.includes('"relationship_counts"') || text.includes('"followers_count"'));

  const emit = (text) => {
    if (relevant(text)) window.postMessage({ source: SOURCE, body: text }, "*");
  };

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    try {
      const url = typeof args[0] === "string" ? args[0] : args[0] && args[0].url;
      if (isGraphql(url)) res.clone().text().then(emit).catch(() => {});
    } catch (_) {}
    return res;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    if (isGraphql(url)) {
      this.addEventListener("load", () => {
        try { emit(this.responseText); } catch (_) {}
      });
    }
    return origOpen.call(this, method, url, ...rest);
  };
})();
