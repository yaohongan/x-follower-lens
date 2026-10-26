// 账号名片:用 Canvas 画一张"粉丝质量体检卡"图片。纯绘图,不读页面、不联网(头像由调用方传入)。
// 三套风格:aurora 极光渐变(默认,颜色随分数变)/ dark 暗夜 / light 纸质浅色。
(() => {
  const W = 800, H = 1180, S = 2;   // 逻辑尺寸;实际像素 ×2,发到 X 上更清晰
  const FONT = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif';
  const THEMES = [["aurora", "极光"], ["dark", "暗夜"], ["light", "纸质"]];

  const rr = (c, x, y, w, h, r) => { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); };
  const ell = (c, text, maxW) => { if (c.measureText(text).width <= maxW) return text; let t = text; while (t.length > 1 && c.measureText(t + "…").width > maxW) t = t.slice(0, -1); return t + "…"; };
  const accent = (s) => (s >= 80 ? ["#10b981", "#06b6d4"] : s >= 60 ? ["#6366f1", "#ec4899"] : s >= 40 ? ["#f59e0b", "#ef4444"] : ["#ef4444", "#be185d"]);
  // 极光配色:分数越高越清爽(青绿→蓝紫),越低越暖(橙→玫红)
  const aurora = (s) => (s >= 80 ? ["#064e3b", "#0e7490", "#4338ca", "#34d399"] : s >= 60 ? ["#1e1b4b", "#4338ca", "#be185d", "#a78bfa"] : s >= 40 ? ["#7c2d12", "#be185d", "#5b21b6", "#fbbf24"] : ["#450a0a", "#9f1239", "#4c1d95", "#fb7185"]);

  function makeTheme(name, score) {
    const [a1, a2] = accent(score);
    if (name === "light") return { name, ink: "#14161a", sub: "rgba(20,22,26,0.55)", panel: "#ffffff", panelStroke: "rgba(20,22,26,0.08)", shadow: "rgba(40,30,10,0.12)", track: "rgba(20,22,26,0.09)", a1, a2, barFill: [a1, a2], tagBg: "#14161a", tagInk: "#fff", footBg: "#14161a", footInk: "rgba(255,255,255,0.7)", discFill: "#ffffff", ring: [a1, a2], num: "#14161a", labelBg: a1, labelInk: "#fff" };
    if (name === "dark") return { name, ink: "#fff", sub: "rgba(255,255,255,0.55)", panel: "rgba(255,255,255,0.07)", panelStroke: "rgba(255,255,255,0.08)", shadow: "transparent", track: "rgba(255,255,255,0.1)", a1, a2, barFill: [a1, a2], tagBg: "rgba(255,255,255,0.12)", tagInk: "#fff", footBg: "rgba(0,0,0,0.3)", footInk: "rgba(255,255,255,0.45)", discFill: "rgba(255,255,255,0.04)", ring: [a1, a2], num: "#fff", labelBg: a1, labelInk: "#0b1020" };
    return { name: "aurora", ink: "#fff", sub: "rgba(255,255,255,0.72)", panel: "rgba(255,255,255,0.14)", panelStroke: "rgba(255,255,255,0.28)", shadow: "rgba(0,0,0,0.25)", track: "rgba(255,255,255,0.22)", a1, a2, barFill: ["#ffffff", "#ffffffcc"], tagBg: "rgba(255,255,255,0.92)", tagInk: "#1e1b4b", footBg: "rgba(0,0,0,0.28)", footInk: "rgba(255,255,255,0.75)", discFill: "rgba(255,255,255,0.14)", ring: ["#ffffff", "#ffffff"], num: "#fff", labelBg: "#ffffff", labelInk: aurora(score)[1], pal: aurora(score) };
  }

  function background(c, t) {
    if (t.name === "aurora") {
      const [p0, p1, p2, hi] = t.pal;
      const g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, p0); g.addColorStop(0.5, p1); g.addColorStop(1, p2);
      c.fillStyle = g; c.fillRect(0, 0, W, H);
      for (const [x, y, r, col] of [[W * 0.9, 80, 420, hi + "88"], [-40, H * 0.55, 380, "#ffffff22"], [W * 0.75, H * 0.92, 420, hi + "55"]]) {
        const rg = c.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, col); rg.addColorStop(1, "transparent"); c.fillStyle = rg; c.fillRect(0, 0, W, H);
      }
      c.fillStyle = "rgba(255,255,255,0.09)";
      for (let x = 24; x < W; x += 32) for (let y = 24; y < H; y += 32) { c.beginPath(); c.arc(x, y, 1.6, 0, 7); c.fill(); }
      c.strokeStyle = "rgba(255,255,255,0.12)"; c.lineWidth = 2;
      for (const r of [260, 380, 500]) { c.beginPath(); c.arc(W + 40, -20, r, 0, 7); c.stroke(); }
    } else if (t.name === "dark") {
      const g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, "#0a0f1f"); g.addColorStop(1, "#141036"); c.fillStyle = g; c.fillRect(0, 0, W, H);
      for (const [x, y, r, col] of [[W * 0.85, 140, 380, t.a1 + "44"], [60, H - 200, 360, t.a2 + "33"]]) {
        const rg = c.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, col); rg.addColorStop(1, "transparent"); c.fillStyle = rg; c.fillRect(0, 0, W, H);
      }
    } else {
      c.fillStyle = "#f3eee4"; c.fillRect(0, 0, W, H);
      for (const [x, y, r, col] of [[W * 0.9, 60, 380, t.a1 + "40"], [0, H * 0.6, 340, t.a2 + "30"]]) {
        const rg = c.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, col); rg.addColorStop(1, "transparent"); c.fillStyle = rg; c.fillRect(0, 0, W, H);
      }
    }
  }

  const panel = (c, t, x, y, w, h, r) => {
    c.save(); c.shadowColor = t.shadow; c.shadowBlur = 28; c.shadowOffsetY = 10;
    rr(c, x, y, w, h, r); c.fillStyle = t.panel; c.fill(); c.restore();
    rr(c, x, y, w, h, r); c.strokeStyle = t.panelStroke; c.lineWidth = 1.5; c.stroke();
  };

  // data: { name, handle(主页地址 x.com/handle 由它拼出), avatar(Image|null), followers, following, ratio, ageText, score:{score,label,parts[]}, tags:[string], date }
  function draw(canvas, data, themeName) {
    canvas.width = W * S; canvas.height = H * S;
    const c = canvas.getContext("2d");
    c.scale(S, S);
    const sc = data.score.score, t = makeTheme(themeName || "aurora", sc);
    background(c, t);

    // 顶栏
    c.textBaseline = "alphabetic"; c.textAlign = "left";
    c.font = `800 18px ${FONT}`; const pillW = c.measureText("ACCOUNT CHECK").width + 70;
    rr(c, 48, 38, pillW, 42, 21); c.fillStyle = t.name === "light" ? "#14161a" : "rgba(255,255,255,0.18)"; c.fill();
    c.fillStyle = "#fff"; c.fillText("🔍 ACCOUNT CHECK", 66, 66);
    c.fillStyle = t.sub; c.font = `600 20px ${FONT}`; c.textAlign = "right"; c.fillText(data.date, W - 48, 66);

    // 身份面板:头像 + 名字
    panel(c, t, 48, 108, W - 96, 150, 30);
    const ax = 48 + 24 + 52, ay = 108 + 75, ar = 52;
    c.save(); c.beginPath(); c.arc(ax, ay, ar, 0, Math.PI * 2); c.clip();
    if (data.avatar) c.drawImage(data.avatar, ax - ar, ay - ar, ar * 2, ar * 2);
    else { c.fillStyle = "#475569"; c.fillRect(ax - ar, ay - ar, ar * 2, ar * 2); c.fillStyle = "#fff"; c.font = `700 52px ${FONT}`; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText((data.name || data.handle || "?").trim().slice(0, 1).toUpperCase(), ax, ay + 2); c.textBaseline = "alphabetic"; }
    c.restore();
    const rg = c.createLinearGradient(ax - ar, ay - ar, ax + ar, ay + ar); rg.addColorStop(0, t.name === "aurora" ? "#fff" : t.a1); rg.addColorStop(1, t.name === "aurora" ? "#ffffffaa" : t.a2);
    c.strokeStyle = rg; c.lineWidth = 5; c.beginPath(); c.arc(ax, ay, ar + 6, 0, Math.PI * 2); c.stroke();
    c.textAlign = "left"; c.fillStyle = t.ink; c.font = `800 38px ${FONT}`; c.fillText(ell(c, data.name || data.handle, 510), 202, 172);
    c.fillStyle = t.sub; c.font = `500 24px ${FONT}`; c.fillText("@" + data.handle, 202, 208);
    c.fillStyle = t.ink; c.globalAlpha = t.name === "light" ? 0.75 : 0.9; c.font = `700 21px ${FONT}`; c.fillText(ell(c, "x.com/" + data.handle, 510), 202, 240); c.globalAlpha = 1;

    // 主角:质量指数
    const cx = W / 2, cy = 462, R = 128;
    c.save(); c.shadowColor = t.shadow; c.shadowBlur = 36; c.shadowOffsetY = 12;
    c.beginPath(); c.arc(cx, cy, R + 34, 0, 7); c.fillStyle = t.discFill; c.fill(); c.restore();
    c.beginPath(); c.arc(cx, cy, R + 34, 0, 7); c.strokeStyle = t.panelStroke; c.lineWidth = 1.5; c.stroke();
    c.lineWidth = 20; c.lineCap = "round"; c.strokeStyle = t.track; c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.stroke();
    const sg = c.createLinearGradient(cx - R, cy - R, cx + R, cy + R); sg.addColorStop(0, t.ring[0]); sg.addColorStop(1, t.ring[1]);
    c.save(); if (t.name === "aurora") { c.shadowColor = "rgba(255,255,255,0.9)"; c.shadowBlur = 22; }
    c.strokeStyle = sg; c.beginPath(); c.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.03, sc / 100)); c.stroke(); c.restore();
    c.textAlign = "center"; c.fillStyle = t.num; c.font = `800 104px ${FONT}`; c.fillText(String(sc), cx, cy + 20);
    c.font = `800 26px ${FONT}`; const lw = c.measureText(data.score.label).width + 44;
    rr(c, cx - lw / 2, cy + 44, lw, 40, 20); c.fillStyle = t.labelBg; c.fill();
    c.fillStyle = t.labelInk; c.fillText(data.score.label, cx, cy + 73);
    c.fillStyle = t.sub; c.font = `600 20px ${FONT}`; c.fillText("粉丝质量指数 / 100 (参考)", cx, cy + R + 62);

    // 四格数字
    const tiles = [["粉丝", data.followers], ["关注", data.following], ["粉丝 / 关注比", data.ratio], ["账号年龄", data.ageText]];
    const tw = (W - 96 - 20) / 2, th = 96;
    tiles.forEach(([k, v], i) => {
      const x = 48 + (i % 2) * (tw + 20), y = 696 + Math.floor(i / 2) * (th + 16);
      panel(c, t, x, y, tw, th, 22);
      c.textAlign = "left"; c.fillStyle = t.sub; c.font = `600 19px ${FONT}`; c.fillText(k, x + 24, y + 34);
      c.fillStyle = t.ink; c.font = `800 36px ${FONT}`; c.fillText(ell(c, String(v), tw - 48), x + 24, y + 76);
    });

    // 四项得分条
    let y = 944;
    for (const p of data.score.parts) {
      c.textAlign = "left"; c.fillStyle = t.ink; c.font = `700 20px ${FONT}`; c.fillText(p.name, 48, y);
      const bx = 196, bw = 340;
      rr(c, bx, y - 14, bw, 12, 6); c.fillStyle = t.track; c.fill();
      const bg2 = c.createLinearGradient(bx, 0, bx + bw, 0); bg2.addColorStop(0, t.barFill[0]); bg2.addColorStop(1, t.barFill[1]);
      rr(c, bx, y - 14, Math.max(12, bw * p.got / p.max), 12, 6); c.fillStyle = bg2; c.fill();
      c.fillStyle = t.sub; c.font = `600 18px ${FONT}`; c.fillText(`${p.got}/${p.max} · ${p.note}`, bx + bw + 16, y);
      y += 34;
    }

    // 标签
    let x = 48; const ty = 1100;
    c.font = `700 20px ${FONT}`;
    for (const tg of data.tags.slice(0, 5)) {
      const w = c.measureText(tg).width + 30; if (x + w > W - 48) break;
      rr(c, x, ty - 38, w, 38, 19); c.fillStyle = t.tagBg; c.fill();
      c.fillStyle = t.tagInk; c.textAlign = "left"; c.fillText(tg, x + 15, ty - 12); x += w + 10;
    }
    // 页脚条
    c.fillStyle = t.footBg; c.fillRect(0, H - 40, W, 40);
    c.textAlign = "center"; c.fillStyle = t.footInk; c.font = `600 16px ${FONT}`;
    c.fillText("由「粉丝透镜」生成 · github.com/yaohongan/x-follower-lens · 指数为公开数据估算", W / 2, H - 14);
  }

  window.FollowerLensCard = { draw, W, H, THEMES };
})();
