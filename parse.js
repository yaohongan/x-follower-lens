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
    flow: true,           // 推文流速标注(每小时浏览量)
    flowMode: "abs",      // abs 绝对流速 / rel 相对流速(按粉丝量折算)
    cardBtn: true,        // 个人主页上显示「生成名片」按钮
    replyMark: true,      // 评论区:大 V 回复高亮
    replyDim: false,      // 评论区:疑似互粉号/低活跃号的回复淡化(默认关)
    fansBar: true,        // 粉丝列表页顶部显示"已统计 N 位粉丝 / 查看粉丝构成"
    fansLines: "3000,10000,30000,50000,100000",   // 粉丝构成分档线(粉丝数)
    replyMark: true,      // 评论区:大 V 的回复高亮
    replyDim: false,      // 评论区:疑似互粉号/低活跃号的回复淡化(默认关)
    notifyMark: true,     // 通知页:谁关注了你,每个新粉丝旁边显示粉丝数和标签;粉丝数达到提醒线的高亮
    notifyLine: 10000,    // 大号提醒线(粉丝数)
    followsBar: true,     // "正在关注"列表页顶部显示"已统计 N 位 · 关注分析"
    reviewBtn: true,      // 个人主页上的"推文复盘"小图标
    fansBar: true,        // 粉丝列表页顶部显示"已统计 N 位粉丝 · 查看粉丝构成"
    fansBtn: true,        // 个人主页上的"粉丝构成"小图标(点一下自动加载并弹出面板)
    fansAuto: true,       // 打开某人的粉丝列表时,自动往下滚、把整份列表加载出来(一次最多 5000 位;动鼠标就停)
    followsAuto: false,   // 同上,"正在关注"列表(默认关)
    fansLines: "3000,10000,30000,50000,100000",   // 粉丝构成的分档线(粉丝数)
    flowSize: "m",        // 流速标大小:m 标准 / l 大 / xl 特大
    avatarSpin: false,    // 头像环转起来(默认静态,不晃眼)
    avatarFx: true,       // 头像特效:按这条推文的流速,给作者头像加圈和小角色
    flowFx: true,         // 流速动效:🚀 火箭和 ⚡ 光速两档带流光、发光等动画
    hideForeign: true,    // 有我们的流速标时,把别的插件的流速标隐藏掉(换成我们的,不再重复、也不会遮挡时间)
    flowPos: "corner",    // 流速位置:corner 替换(默认,排进标题行 + 隐藏别人的)/ header 头部(让到别人的左边)/ auto 自动 / bar 底部
    layout: "below",      // 徽标位置:below 单独一行(默认)/ auto 自动 / inline 行内。昵称后面再跟一串标签太长,放到下一行更干净
    maxTags: 3,           // 徽标里最多显示几个标签(0 = 只显示粉丝数)
    debug: false,         // 左下角调试条
    tags: {
      relation: true,     // 互关 / 关注了你
      bigV: true,
      farm: true,         // 疑似互粉号
      newAcct: true,
      oldAcct: true,
      engaged: true,      // 高互动
      lowActive: true,
      domain: true,       // 内容方向(AI编程、出海变现……)
    },
    customDomains: "",    // 自定义方向,每行一个:名称=关键词1,关键词2
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
    const bio = (u.profile_bio && u.profile_bio.description) || legacy.description || "";
    return {
      handle: String(handle).toLowerCase(),
      name: core.name || legacy.name || "",
      bio,
      followers: num(followers),
      following: num(following),
      tweets: tc.tweets ?? legacy.statuses_count ?? null,
      createdAt: core.created_at || legacy.created_at || null,
      avatar: (u.avatar && u.avatar.image_url) || legacy.profile_image_url_https || u.profile_image_url_https || "",
      followedBy: rp.followed_by === true,   // 对方关注了我
      iFollow: rp.following === true,        // 我关注了对方
      st: readStatus(u, legacy, rp),         // 账号状态(X 页面数据里自带的标记)
    };
  }

  // 账号状态:只读 X 页面自己已经带着的字段(受保护、敏感内容提示、认证、恶搞号标注、屏蔽关系……),不发任何请求
  function readStatus(u, legacy, rp) {
    const meta = u.profile_metadata || {};
    const vi = u.verification_info || {};
    const since = vi.reason && Number(vi.reason.verified_since_msec);
    const label = u.affiliates_highlighted_label && u.affiliates_highlighted_label.label;
    const parody = u.parody_commentary_fan_label;
    const wh = u.withheld_in_countries || legacy.withheld_in_countries;
    return {
      prot: (u.privacy && u.privacy.protected === true) || legacy.protected === true,
      sens: u.possibly_sensitive === true || legacy.possibly_sensitive === true,
      inter: String(meta.profile_interstitial_type || ""),
      parody: parody && parody !== "None" ? String(parody) : "",
      blue: u.is_blue_verified === true,
      ver: (u.verification && u.verification.verified === true) || legacy.verified === true,
      idv: vi.is_identity_verified === true,
      since: since > 0 ? since : 0,
      wh: Array.isArray(wh) && wh.length ? wh.map(String) : null,
      blockedBy: rp.blocked_by === true, blocking: rp.blocking === true, muting: rp.muting === true,
      org: label && label.description ? String(label.description) : "",
    };
  }

  // 把账号状态翻成人话。level: 2 = 要留意(红点)、1 = 提醒(黄点)、0 = 只是信息、-1 = 好事(认证)
  const INTERSTITIAL = {
    fake_account: "X 给这个账号加了「疑似虚假账号」提示",
    offensive_profile_content: "X 提示这个账号的资料可能含冒犯内容",
    timeout: "这个账号目前被 X 临时限制",
    sensitive_media: "X 提示这个账号可能含敏感媒体",
  };
  function statusOf(u) {
    const s = u && u.st;
    if (!s) return { items: [], risk: 0 };
    const items = [];
    const add = (icon, text, level) => items.push({ icon, text, level });
    if (s.inter && s.inter !== "none") add("⚠️", INTERSTITIAL[s.inter] || `X 给这个账号加了提示(${s.inter})`, 2);
    if (s.wh) add("🌐", `在 ${s.wh.length} 个地区被屏蔽(${s.wh.slice(0, 6).join("、")}${s.wh.length > 6 ? "…" : ""})`, 2);
    if (s.sens) add("🔞", "账号被标记为可能含敏感内容", 1);
    if (s.blockedBy) add("🚫", "TA 屏蔽了你", 1);
    if (s.prot) add("🔒", "受保护账号:只有 TA 的关注者看得到推文", 0);
    if (s.parody) add("🎭", { Parody: "恶搞账号(账号自己声明的)", Commentary: "评论账号(账号自己声明的)", Fan: "粉丝账号(账号自己声明的)" }[s.parody] || `账号标注:${s.parody}`, 0);
    if (s.blocking) add("⛔", "你屏蔽了 TA", 0);
    if (s.muting) add("🔇", "你静音了 TA", 0);
    const ym = s.since ? (() => { const d = new Date(s.since); return ` · 自 ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; })() : "";
    if (s.idv) add("✅", `已通过身份认证${ym}`, -1);
    else if (s.ver) add("✅", `旧版认证${ym}`, -1);
    else if (s.blue) add("☑️", `蓝标${ym}(订阅得来的,不等于核实过身份)`, -1);
    if (s.org) add("🏢", `隶属组织:${s.org}`, 0);
    return { items, risk: items.reduce((m, i) => Math.max(m, i.level), 0) };
  }

  // ---- 粉丝构成:按粉丝数分档 ----
  const FANS_DEFAULT = [3000, 10000, 30000, 50000, 100000];
  function parseFansLines(s) {
    const a = String(s || "").split(/[,\s，、]+/).map((x) => Number(x.replace(/[万w]$/i, (m) => "0000"))).filter((x) => x > 0);
    const u = [...new Set(a)].sort((x, y) => x - y);
    return u.length ? u : FANS_DEFAULT;
  }
  function fmtLine(n) { return n >= 10000 ? String(n / 10000).replace(/\.0$/, "") + "万" : String(n); }
  function fansBandNames(lines) {
    const out = [`< ${fmtLine(lines[0])}`];
    for (let i = 0; i < lines.length - 1; i++) out.push(`${fmtLine(lines[i])} – ${fmtLine(lines[i + 1])}`);
    out.push(`≥ ${fmtLine(lines[lines.length - 1])}`);
    return out;
  }
  // rows: [[followers, following, createdMs], ...]
  function fansSummary(rows, lines, now) {
    const counts = new Array(lines.length + 1).fill(0);
    let farm = 0, fresh = 0;
    for (const r of rows) {
      let i = 0;
      while (i < lines.length && r[0] >= lines[i]) i++;
      counts[i]++;
      const ratio = r[1] > 0 ? r[0] / r[1] : r[0] > 0 ? 99 : 1;
      if (r[1] >= 1000 && ratio > 0.8 && ratio < 1.25 && r[0] < 5000) farm++;
      if (r[2] && (now - r[2]) / 86400000 < 90) fresh++;
    }
    const n = rows.length;
    const ge = (x) => rows.reduce((c, r) => c + (r[0] >= x ? 1 : 0), 0);
    return { n, counts, names: fansBandNames(lines), farm, fresh, ge3k: ge(3000), ge10k: ge(10000), ge30k: ge(30000) };
  }

  // ---- 关注列表分析 ----
  // rows: [[粉丝数, 关注数, 注册时间ms, 记录时间ms, 对方是否关注你(1/0)], ...]
  const isFarmRow = (r) => { const ratio = r[1] > 0 ? r[0] / r[1] : r[0] > 0 ? 99 : 1; return r[1] >= 1000 && ratio > 0.8 && ratio < 1.25 && r[0] < 5000; };
  const FOLLOW_FILTERS = {
    all: { name: "全部", fn: () => true },
    nofb: { name: "没关注你", fn: (r) => !r[4] },
    farm: { name: "疑似互粉号", fn: isFarmRow },
    fresh: { name: "新号(<90 天)", fn: (r, now) => !!r[2] && (now - r[2]) / 86400000 < 90 },
    big: { name: "≥ 1 万粉", fn: (r) => r[0] >= 10000 },
    small: { name: "< 100 粉", fn: (r) => r[0] < 100 },
  };
  function followsSummary(rows, now) {
    const out = { n: rows.length };
    for (const k in FOLLOW_FILTERS) out[k] = rows.reduce((c, r) => c + (FOLLOW_FILTERS[k].fn(r, now) ? 1 : 0), 0);
    return out;
  }
  const FOLLOW_SORTS = {
    fol: { name: "粉丝数 多→少", cmp: (a, b) => b[1][0] - a[1][0] },
    folAsc: { name: "粉丝数 少→多", cmp: (a, b) => a[1][0] - b[1][0] },
    ratio: { name: "粉丝/关注比 高→低", cmp: (a, b) => (b[1][0] / Math.max(1, b[1][1])) - (a[1][0] / Math.max(1, a[1][1])) },
    recent: { name: "最近记录", cmp: (a, b) => b[1][3] - a[1][3] },
  };

  // ---- 推文复盘 ----
  // items: [{ id, views, createdAt, inter, text }]。只算浏览量 ≥ 1 的
  const HOUR_BLOCKS = [["凌晨 0–6 点", 0, 6], ["上午 6–12 点", 6, 12], ["下午 12–18 点", 12, 18], ["晚上 18–24 点", 18, 24]];
  function tweetsSummary(items, now) {
    const t = (items || []).filter((x) => x.views >= 1 && x.createdAt);
    const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
    const mature = t.filter((x) => (now - new Date(x.createdAt).getTime()) / 3600e3 >= 24);   // 发出一天以上,浏览量基本到位
    const blocks = HOUR_BLOCKS.map(([name, lo, hi]) => {
      const vs = mature.filter((x) => { const h = new Date(x.createdAt).getHours(); return h >= lo && h < hi; }).map((x) => x.views);
      return { name, n: vs.length, avg: vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : 0 };
    });
    const totV = t.reduce((a, x) => a + x.views, 0), totI = t.reduce((a, x) => a + (x.inter || 0), 0);
    const ranked = blocks.filter((b) => b.n >= 2).sort((a, b) => b.avg - a.avg);
    return {
      n: t.length, nMature: mature.length, median: median(t.map((x) => x.views)),
      er: totV ? totI / totV : null,
      top: [...t].sort((a, b) => b.views - a.views).slice(0, 10),
      blocks, best: ranked.length >= 2 ? ranked[0] : null,
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
      createdAt: legacy.created_at || null,
      text: legacy.full_text && !/^RT @/.test(legacy.full_text) ? legacy.full_text : "",   // 转推的正文不是作者写的,不算
      interactions:
        num(legacy.favorite_count) + num(legacy.retweet_count) +
        num(legacy.reply_count) + num(legacy.quote_count),
    };
  }

  // 返回 { users: [...], tweets: [...] }
  function extract(json) {
    const users = [];
    const tweets = [];

    // JSON.parse 出来的是树,没有环,不需要 WeakSet 去重(对几百 KB 的响应能省不少)
    (function walk(node) {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) { for (let i = 0; i < node.length; i++) walk(node[i]); return; }

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
  function tags(user, stat, now, cfg, extra) {
    const on = (cfg && cfg.tags) || DEFAULTS.tags;
    const out = [];
    const { followers, following } = user;
    const ratio = ratioOf(user);

    if (on.relation) {
      if (user.followedBy && user.iFollow) out.push({ key: "relation", text: "互关", cls: "rel" });
      else if (user.followedBy) out.push({ key: "relation", text: "关注了你", cls: "rel" });
    }
    if (on.domain && extra && extra.domain) out.push({ key: "domain", text: extra.domain.name, cls: "dom", dom: extra.domain.key });
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

  // ---- 粉丝质量指数(0-100):名片上的大数字。纯启发式、全部来自公开数字,只是参考,不是判决 ----
  // 四项:粉丝/关注比 35 分、互动率 30 分(样本不足按中间值 15,并标明)、账号年龄 20 分、内容产出 15 分;疑似互粉号扣 15 分。
  function qualityScore(user, stat, now) {
    const ratio = ratioOf(user);
    const rScore = ratio >= 10 ? 35 : ratio >= 3 ? 28 : ratio >= 1 ? 20 : ratio >= 0.5 ? 12 : 5;
    const days = user.createdAt ? (now - new Date(user.createdAt).getTime()) / 86400000 : null;
    const aScore = days === null ? 8 : days >= 1825 ? 20 : days >= 730 ? 15 : days >= 365 ? 10 : days >= 90 ? 6 : 2;
    const er = engagementOf(stat);
    const eScore = er === null ? 15 : er >= 0.03 ? 30 : er >= 0.01 ? 24 : er >= 0.003 ? 16 : er >= 0.001 ? 9 : 3;
    const t = user.tweets;
    const pScore = t === null || t === undefined ? 7 : t >= 3000 ? 15 : t >= 500 ? 11 : t >= 100 ? 7 : 3;
    const farm = user.following >= 1000 && ratio > 0.8 && ratio < 1.25 && user.followers < 5000;
    const score = Math.max(0, Math.min(100, rScore + aScore + eScore + pScore - (farm ? 15 : 0)));
    const label = score >= 80 ? "优质" : score >= 60 ? "良好" : score >= 40 ? "一般" : "存疑";
    return {
      score, label, farm, er,
      parts: [
        { name: "粉丝关注比", got: rScore, max: 35, note: fmtRatio(ratio) },
        { name: "互动率", got: eScore, max: 30, note: er === null ? "样本不足" : (er * 100).toFixed(2) + "%" },
        { name: "账号年龄", got: aScore, max: 20, note: days === null ? "未知" : days >= 365 ? (days / 365).toFixed(1).replace(/\.0$/, "") + " 年" : Math.max(1, Math.round(days / 30.44)) + " 个月" },
        { name: "内容产出", got: pScore, max: 15, note: t === null || t === undefined ? "未知" : Number(t).toLocaleString() + " 条" },
      ],
    };
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

  // ---- 内容方向:按账号简介和刷到过的推文,判断博主主要做什么 ----
  // 词典来自对真实时间线样本的观察:这个圈子几乎人人带"AI",能区分的是"用 AI 做什么"。
  // weight < 1 的方向(泛词多)需要更多证据才显示。拉丁词按单词边界匹配,中文词按子串匹配。
  const DOMAINS = [
    { key: "code", name: "AI编程", weight: 1, kw: ["vibe coding", "vibecoding", "vibe coder", "cursor", "claude code", "codex", "copilot", "windsurf", "程序员", "开发者", "独立开发", "全栈", "前端", "后端", "coding", "developer", "software engineer", "软件工程师", "ai engineer", "engineering", "code", "coder", "programmer", "unity", "开源项目", "编程", "写代码", "程序猿", "github"] },
    { key: "agent", name: "智能体", weight: 1, kw: ["agent", "智能体", "工作流", "workflow", "mcp", "fde", "skills", "skill", "自动化", "n8n", "dify", "coze", "langchain", "openclaw", "multi-agent"] },
    { key: "video", name: "AI视频", weight: 1, kw: ["ai视频", "ai电影", "视频生成", "短视频", "可灵", "即梦", "sora", "veo", "runway", "kling", "seedance", "海螺", "剪辑", "影视", "视效", "分镜", "数字人", "video generation", "ai video", "电影"] },
    { key: "design", name: "AI设计", weight: 1, kw: ["设计师", "设计", "midjourney", "生图", "绘画", "绘图", "插画", "视觉", "海报", "comfyui", "stable diffusion", "flux", "nano banana", "figma", "ui", "ux", "design", "designer", "文生图", "美术"] },
    { key: "model", name: "大模型", weight: 1, kw: ["大模型", "llm", "研究员", "算法", "模型评测", "论文", "本地模型", "强化学习", "rl", "research", "researcher", "机器学习", "deep learning", "transformer", "预训练", "微调", "fine-tuning", "ai研究", "frontier"] },
    { key: "biz", name: "出海变现", weight: 1, kw: ["出海", "变现", "副业", "赚钱", "赚美金", "美金", "美刀", "saas", "增长黑客", "seo", "一人公司", "一人事业", "mrr", "月入", "创业", "startup", "indie", "build in public", "building in public", "arr", "营收"] },
    { key: "tools", name: "AI工具", weight: 1, fallback: true, kw: ["ai工具", "工具实战", "工具分享", "好用工具", "效率工具", "提效", "薅羊毛", "tools", "实用技巧", "教程", "横评", "实测"] },
    { key: "creator", name: "自媒体", weight: 1, kw: ["自媒体", "涨粉", "运营", "内容创作", "公众号", "小红书", "抖音", "社群", "博主", "创作者", "newsletter", "youtube", "youtuber", "播客", "写作"] },
    { key: "invest", name: "投资", weight: 1, kw: ["美股", "a股", "港股", "股票", "投资", "投研", "基金", "量化", "期权", "财经", "宏观", "财报", "交易", "investor", "invest", "stock", "trading", "全球资产"] },
    { key: "web3", name: "Web3", weight: 1, kw: ["web3", "crypto", "btc", "比特币", "eth", "以太坊", "defi", "nft", "链上", "solana", "空投", "airdrop", "铭文", "gamefi", "币圈", "meme", "加密", "dex", "alpha"] },
    { key: "product", name: "产品", weight: 0.8, kw: ["产品经理", "产品", "pm", "apm", "product manager", "product", "用户体验"] },
    { key: "life", name: "成长", weight: 0.5, fallback: true, kw: ["学习", "成长", "读书", "随笔", "日常", "生活", "思考", "复盘", "记录", "认知", "感悟", "长期主义", "life", "journal"] },
    { key: "ai", name: "AI", weight: 0.4, fallback: true, kw: ["ai", "aigc", "人工智能", "gpt", "chatgpt", "claude", "gemini", "deepseek", "grok", "openai", "anthropic"] },
  ];
  const DOMAIN_MIN = 3;   // 加权得分达到才显示:简介命中 1 个词 = 3 分,推文命中 1 条 = 1 分

  const escRx = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  function compileDomain(d) {
    return { key: d.key, name: d.name, weight: d.weight, fallback: !!d.fallback, rxs: d.kw.map((w) => /^[\x00-\x7f]+$/.test(w) ? new RegExp("(?<![a-z0-9])" + escRx(w.toLowerCase()) + "(?![a-z0-9])") : new RegExp(escRx(w.toLowerCase()))) };
  }
  const BUILTIN = DOMAINS.map(compileDomain);

  // 自定义方向:每行"名称=关键词1,关键词2"。排在内置之前,权重 1.2(你写的优先)
  const customCache = { text: null, rows: [] };
  function parseCustomDomains(text) {
    if (customCache.text === text) return customCache.rows;     // 词典没变就复用,别每个账号都重新编译
    const out = [];
    String(text || "").split(/\r?\n/).forEach((line, i) => {
      const m = line.match(/^\s*([^=]{1,8}?)\s*[=＝]\s*(.+)$/);
      if (!m) return;
      const kw = m[2].split(/[,，、]/).map((x) => x.trim()).filter(Boolean);
      if (kw.length) out.push(compileDomain({ key: "custom" + i, name: m[1].trim(), weight: 1.2, kw }));
    });
    customCache.text = text; customCache.rows = out;
    return out;
  }

  // 每个方向命中了几个不同的词。"ai 视频"这种中间有空格的先去掉空格
  function domainHits(text, domains) {
    // 先去掉链接和 @账号名(里面的词不是内容,比如 @t3dotcodes),再把"ai 视频"这种中间的空格去掉
    const t = String(text || "").toLowerCase().replace(/https?:\/\/\S+/g, " ").replace(/@\w+/g, " ").replace(/ai\s+(?=[\u4e00-\u9fff])/g, "ai");
    const out = {};
    for (const d of domains) { let n = 0; for (const rx of d.rxs) if (rx.test(t)) n++; if (n) out[d.key] = n; }
    return out;
  }

  // bio: 简介文本;tweetScores: { 方向key: 命中的推文条数 }(累计);custom: 自定义词典文本
  // 返回 [{key,name,score}] 从高到低,只含够分数的
  function pickDomains(bio, tweetScores, custom) {
    const domains = [...parseCustomDomains(custom), ...BUILTIN];
    const hits = domainHits(bio, domains);
    const ts = tweetScores || {};
    const rows = [];
    domains.forEach((d, order) => {
      const raw = Math.min(hits[d.key] || 0, 2) * 3 + Math.min(ts[d.key] || 0, 6);
      const score = raw * d.weight;
      if (score >= DOMAIN_MIN) rows.push({ key: d.key, name: d.name, score, order, fallback: d.fallback });
    });
    // 兜底方向(AI工具、成长、泛 AI)只在没有更具体方向时才作数
    const specific = rows.filter((r) => !r.fallback);
    const list = specific.length ? specific : rows;
    return list.sort((a, b) => b.score - a.score || a.order - b.order).map(({ key, name, score }) => ({ key, name, score }));
  }

  // 一条推文属于哪些方向(用来累计 tweetScores)
  function tweetDomains(text, custom) {
    return Object.keys(domainHits(text, [...parseCustomDomains(custom), ...BUILTIN]));
  }

  // ---- 流速:推文发布后平均每小时的浏览量 ----
  const FLOW_TIERS = [
    { emoji: "🌱", name: "萌芽" },
    { emoji: "🍃", name: "起风" },
    { emoji: "🌊", name: "涌浪" },
    { emoji: "🔥", name: "沸腾" },
    { emoji: "🌋", name: "喷发" },
  ];
  const FLOW_ABS = [18, 90, 480, 2400];    // 每小时浏览量的分档线(= 每分钟 0.3 / 1.5 / 8 / 40 次)
  const FLOW_REL = [0.5, 2, 8, 30];        // 每小时、每千粉丝的浏览量
  const FLOW_MIN_AGE_H = 1 / 60;           // 发布不足 1 分钟:太早,不算
  const FLOW_FRESH_MIN_H = 0.25;           // 15 分钟内算"刚发布":浏览量还少,数字不稳,低档位(龟速)会误导,不显示
  const FLOW_MIN_VIEWS = 1;                // 至少 1 次浏览(0 次没有速度可言)。不再设"样本太小不算"的门槛,和别的流速插件一样都显示
  const FLOW_FRESH_H = 24;                 // 24 小时内:"实时流速",带趋势箭头
  const FLOW_MAX_AGE_H = 720;              // 超过 30 天不算。24 小时~30 天之间是"发布以来的平均速度"(old: true)

  // t: { views, createdAt }  返回 null 表示不显示
  function flowOf(t, followers, now, mode) {
    if (!t || !t.createdAt || !(t.views >= FLOW_MIN_VIEWS)) return null;
    const ageH = (now - new Date(t.createdAt).getTime()) / 3600e3;
    if (!(ageH >= FLOW_MIN_AGE_H) || ageH > FLOW_MAX_AGE_H) return null;
    const rate = t.views / ageH;
    const rel = mode === "rel";
    const value = rel ? rate / Math.max((followers || 0) / 1000, 1) : rate;
    const lines = rel ? FLOW_REL : FLOW_ABS;
    let idx = 0;
    while (idx < lines.length && value >= lines[idx]) idx++;
    return { rate, ageH, tier: idx, old: ageH > FLOW_FRESH_H, fresh: ageH < FLOW_FRESH_MIN_H, ...FLOW_TIERS[idx] };
  }

  // 趋势:用同一条推文的几次观察(浏览量 + 时间),算"最近这一阵"的速度,和发布以来的平均速度比。
  // obs: [{ views, at }, ...] 按时间从早到晚;avgRate:发布以来平均每小时浏览量
  // 基准取"距最新一次观察至少 minGapMs 之前"里最近的一次,间隔太短算出来是噪音。
  function trendOf(obs, avgRate, minGapMs) {
    if (!obs || obs.length < 2 || !(avgRate > 0)) return null;
    const gapMin = minGapMs === undefined ? 120000 : minGapMs;
    const last = obs[obs.length - 1];
    let base = null;
    for (let i = obs.length - 2; i >= 0; i--) {
      if (last.at - obs[i].at >= gapMin) { base = obs[i]; break; }
    }
    if (!base) return null;
    const dv = last.views - base.views;
    if (dv < 10) return null;                                   // 增量太小,不下结论
    const recent = dv / ((last.at - base.at) / 3600e3);
    const ratio = recent / avgRate;
    return { recent, ratio, dir: ratio >= 1.3 ? "up" : ratio <= 0.5 ? "down" : "flat" };
  }

  // 标上显示的速度:每分钟被看多少次(rate 是每小时的)
  function fmtPace(rate) {
    const m = rate / 60;
    return m >= 1000 ? (m / 1000).toFixed(m >= 10000 ? 0 : 1).replace(/\.0$/, "") + "k" : m >= 10 ? String(Math.round(m)) : m >= 1 ? m.toFixed(1).replace(/\.0$/, "") : "<1";
  }

  // TA 平时的水平:同一作者已经"发酵完"(发出 ≥24 小时、≤90 天)的其它推文,浏览量的中位数。样本不足 3 条返回 null。
  // items: [{ id, views, createdAt }];selfId 本条不算进去
  function usualViews(items, selfId, now) {
    const v = [];
    for (const t of items || []) {
      if (t.id === selfId || !(t.views >= 1) || !t.createdAt) continue;
      const ageH = (now - new Date(t.createdAt).getTime()) / 3600e3;
      if (ageH >= 24 && ageH <= 2160) v.push(t.views);
    }
    if (v.length < 3) return null;
    v.sort((a, b) => a - b);
    const mid = v.length >> 1;
    return { median: v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2, n: v.length };
  }

  function fmtRate(r) {
    return r >= 10000 ? (r / 1000).toFixed(0) + "k" : r >= 1000 ? (r / 1000).toFixed(1).replace(/\.0$/, "") + "k" : String(Math.round(r));
  }

  const api = { pickDomains, tweetDomains, parseCustomDomains, DOMAINS, FLOW_TIERS, flowOf, trendOf, fmtRate, DEFAULTS, mergeSettings, extract, tags, tier, fmt, fmtRatio, ratioOf, engagementOf, shouldDim, deltaFrom, qualityScore, fmtPace, usualViews, statusOf, parseFansLines, fansBandNames, fansSummary, FOLLOW_FILTERS, FOLLOW_SORTS, followsSummary, tweetsSummary };
  if (typeof module !== "undefined") module.exports = api;
  else root.FollowerLensParse = api;
})(typeof window !== "undefined" ? window : globalThis);
