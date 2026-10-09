// 纯函数:从 GraphQL JSON 里递归提取用户与推文统计,并判断质量标签。
// 字段解析集中在这里,X 改版时只改此文件。
(function (root) {
  const num = (v) => (typeof v === "number" ? v : Number(v) || 0);

  const DEFAULTS = {
    enabled: true,        // 总开关
    showRatio: false,     // 徽标里显示粉丝/关注比
    tierColors: true,     // 按粉丝量分级配色
    hoverCard: true,      // 悬停详情卡
    trackHistory: true,   // 本地记录粉丝数变化
    dimLowQuality: true,  // 在关注/粉丝列表里淡化疑似互粉号、低活跃号
    debug: false,         // 左下角调试条
    tags: {
      relation: true,     // 互关 / 关注了你
      bigV: true,
      farm: true,         // 疑似互粉号
      newAcct: true,
      oldAcct: true,
      engaged: true,      // 高互动
      lowActive: true,
    },
  };

  function mergeSettings(saved) {
    const s = saved || {};
    return Object.assign({}, DEFAULTS, s, { tags: Object.assign({}, DEFAULTS.tags, s.tags) });
  }

  function readUser(u) {
    const legacy = u.legacy || {};
    const core = u.core || {};
    const handle = core.screen_name || legacy.screen_name;
    if (!handle) return null;
    const rc = u.relationship_counts || {};
    const followers = rc.followers ?? legacy.followers_count ?? u.followers_count;
    const following = rc.following ?? legacy.friends_count ?? u.friends_count;
    if (followers === undefined) return null;
    const rp = u.relationship_perspectives || {};
    const tc = u.tweet_counts || {};
    return {
      handle: String(handle).toLowerCase(),
      name: core.name || legacy.name || "",
      followers: num(followers),
      following: num(following),
      tweets: tc.tweets ?? legacy.statuses_count ?? null,
      createdAt: core.created_at || legacy.created_at || null,
      followedBy: rp.followed_by === true,   // 对方关注了我
      iFollow: rp.following === true,        // 我关注了对方
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

  const ratioOf = (u) => (u.following > 0 ? u.followers / u.following : u.followers);

  function engagementOf(stat) {
    if (!stat || stat.views < 2000) return null;
    return stat.interactions / stat.views;
  }

  // 质量标签。阈值是经验值,放在这里方便调。按展示优先级排序。
  function tags(user, stat, now, cfg) {
    const on = (cfg && cfg.tags) || DEFAULTS.tags;
    const out = [];
    const { followers, following } = user;
    const ratio = ratioOf(user);

    if (on.relation) {
      if (user.followedBy && user.iFollow) out.push({ key: "relation", text: "互关", cls: "rel" });
      else if (user.followedBy) out.push({ key: "relation", text: "关注了你", cls: "rel" });
    }
    if (on.bigV && followers >= 10000 && ratio >= 10) out.push({ key: "bigV", text: "大V", cls: "hi" });
    if (on.farm && following >= 1000 && ratio > 0.8 && ratio < 1.25 && followers < 5000)
      out.push({ key: "farm", text: "疑似互粉号", cls: "warn" });

    const days = user.createdAt ? (now - new Date(user.createdAt).getTime()) / 86400000 : null;
    if (on.newAcct && days !== null && days >= 0 && days < 90) out.push({ key: "newAcct", text: "新号", cls: "warn" });

    const er = engagementOf(stat);
    if (er !== null) {
      if (on.engaged && er >= 0.03) out.push({ key: "engaged", text: "高互动", cls: "hi" });
      else if (on.lowActive && er < 0.001 && followers >= 5000)
        out.push({ key: "lowActive", text: "低活跃", cls: "warn" });
    }
    // 老号信息量最低,排最后(徽标最多展示前 3 个)
    if (on.oldAcct && days !== null && days > 365 * 8) out.push({ key: "oldAcct", text: "老号", cls: "" });
    return out;
  }

  // 粉丝量分级 0..4,用于徽标配色
  function tier(followers) {
    if (followers >= 1e6) return 4;
    if (followers >= 1e5) return 3;
    if (followers >= 1e4) return 2;
    if (followers >= 1e3) return 1;
    return 0;
  }

  // 1 万以内显示精确值,以上用"万"、"亿"
  function fmt(n) {
    if (n < 10000) return String(n);
    if (n < 1e8) return (n / 1e4).toFixed(n < 1e5 ? 2 : 1).replace(/\.?0+$/, "") + "万";
    return (n / 1e8).toFixed(2).replace(/\.?0+$/, "") + "亿";
  }

  function fmtRatio(r) {
    return r >= 100 ? String(Math.round(r)) : r >= 10 ? r.toFixed(0) : r.toFixed(1);
  }

  // 淡化条件:疑似互粉号或低活跃号(且对应标签开关打开)
  function shouldDim(tagList) {
    return tagList.some((t) => t.key === "farm" || t.key === "lowActive");
  }

  // 历史变化:在 history(数组 [[ts, followers], ...])里找约 7 天前的基准点
  function deltaFrom(history, current, now) {
    if (!history || history.length < 2) return null;
    const MIN_AGE = 20 * 3600e3;
    const WEEK = 7 * 86400e3;
    let best = null;
    for (const [ts, f] of history) {
      const age = now - ts;
      if (age < MIN_AGE) continue;
      if (!best || Math.abs(age - WEEK) < Math.abs(now - best.ts - WEEK)) best = { ts, f };
    }
    if (!best) return null;
    return { days: Math.max(1, Math.round((now - best.ts) / 86400e3)), diff: current - best.f, base: best.f };
  }

  const api = { DEFAULTS, mergeSettings, extract, tags, tier, fmt, fmtRatio, ratioOf, engagementOf, shouldDim, deltaFrom };
  if (typeof module !== "undefined") module.exports = api;
  else root.FollowerLensParse = api;
})(typeof window !== "undefined" ? window : globalThis);
