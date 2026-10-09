// 纯函数:从 GraphQL JSON 里递归提取用户与推文统计。字段解析集中在这里,X 改版时只改此文件。
(function (root) {
  const num = (v) => (typeof v === "number" ? v : Number(v) || 0);

  function readUser(u) {
    const legacy = u.legacy || {};
    const core = u.core || {};
    const handle = core.screen_name || legacy.screen_name;
    if (!handle) return null;
    const rc = u.relationship_counts || {};
    const followers = rc.followers ?? legacy.followers_count ?? u.followers_count;
    const following = rc.following ?? legacy.friends_count ?? u.friends_count;
    if (followers === undefined) return null;
    return {
      handle: String(handle).toLowerCase(),
      followers: num(followers),
      following: num(following),
      createdAt: core.created_at || legacy.created_at || null,
    };
  }

  function readTweet(t, author) {
    const legacy = t.legacy || {};
    if (!t.rest_id || legacy.favorite_count === undefined) return null;
    const views = t.views && t.views.count !== undefined ? num(t.views.count) : 0;
    return {
      id: t.rest_id,
      author,
      views,
      interactions:
        num(legacy.favorite_count) + num(legacy.retweet_count) +
        num(legacy.reply_count) + num(legacy.quote_count),
    };
  }

  // 返回 { users: [...], tweets: [...] }
  function extract(json) {
    const users = [];
    const tweets = [];
    const seen = new WeakSet();

    (function walk(node) {
      if (!node || typeof node !== "object" || seen.has(node)) return;
      seen.add(node);
      if (Array.isArray(node)) { node.forEach(walk); return; }

      if (node.__typename === "User") {
        const u = readUser(node);
        if (u) users.push(u);
      } else if (node.__typename === "Tweet" && node.core && node.core.user_results) {
        const au = node.core.user_results.result;
        const author = au && readUser(au);
        if (author) {
          const t = readTweet(node, author.handle);
          if (t) tweets.push(t);
        }
      }
      for (const k in node) walk(node[k]);
    })(json);

    return { users, tweets };
  }

  // 质量标签。阈值是经验值,放在这里方便调。
  function tags(user, stat, now) {
    const out = [];
    const { followers, following } = user;
    const ratio = following > 0 ? followers / following : followers;
    if (followers >= 10000 && ratio >= 10) out.push({ text: "大V", cls: "hi" });
    if (following >= 1000 && ratio > 0.8 && ratio < 1.25 && followers < 5000)
      out.push({ text: "疑似互粉号", cls: "warn" });
    if (user.createdAt) {
      const days = (now - new Date(user.createdAt).getTime()) / 86400000;
      if (days >= 0 && days < 90) out.push({ text: "新号", cls: "warn" });
      else if (days > 365 * 8) out.push({ text: "老号", cls: "" });
    }
    if (stat && stat.views >= 2000) {
      const er = stat.interactions / stat.views;
      if (er >= 0.03) out.push({ text: "高互动", cls: "hi" });
      else if (er < 0.001 && followers >= 5000) out.push({ text: "低活跃", cls: "warn" });
    }
    return out;
  }

  const api = { extract, tags };
  if (typeof module !== "undefined") module.exports = api;
  else root.FollowerLensParse = api;
})(typeof window !== "undefined" ? window : globalThis);
