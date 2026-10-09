// 运行在页面主世界:只读 X 自己发出的 GraphQL 响应,不主动发任何请求。
(() => {
  console.log("[FL] inject.js 已加载 (主世界)");
  const SOURCE = "follower-lens";
  const isGraphql = (url) => typeof url === "string" && url.includes("/i/api/graphql/");

  const emit = (text) => {
    window.postMessage({ source: SOURCE, body: text }, "*");
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
