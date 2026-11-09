// 账号名片:用 Canvas 画一张"粉丝质量体检卡"图片。纯绘图,不读页面、不联网(头像由调用方传入)。
// 两套风格:wrapped 年度(默认,整块高饱和色,颜色随分数变)/ gold 黑金(哑光黑底 + 金色线条与衬线数字)。
(() => {
  const W = 800, H = 1180, S = 2;   // 逻辑尺寸;实际像素 ×2,发到 X 上更清晰
  const FONT = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif';
  const THEMES = [["wrapped", "年度"], ["gold", "黑金"]];

  const rr = (c, x, y, w, h, r) => { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); };
  const ell = (c, text, maxW) => { if (c.measureText(text).width <= maxW) return text; let t = text; while (t.length > 1 && c.measureText(t + "…").width > maxW) t = t.slice(0, -1); return t + "…"; };
  // ================= 新风格:海报 / 便当 / 年度 / 黑金 =================
  const NUM = '"SF Pro Display","Helvetica Neue","Inter","Segoe UI",' + FONT;
  const SERIF = '"Songti SC","STSong","Noto Serif SC","Source Han Serif SC",Georgia,serif';
  const F = (w, s, fam) => `${w} ${s}px ${fam || FONT}`;
  const spaced = (c, px, fn) => { c.letterSpacing = px + "px"; fn(); c.letterSpacing = "0px"; };
  const ageS = (d) => d.ageText.split(" · ")[1] || d.ageText;
  const grade = (s) => (s >= 80 ? "A" : s >= 60 ? "B" : s >= 40 ? "C" : "D");
  const circleImg = (c, data, x, y, r) => {
    c.save(); c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.clip();
    if (data.avatar) c.drawImage(data.avatar, x - r, y - r, r * 2, r * 2);
    else { c.fillStyle = "#475569"; c.fillRect(x - r, y - r, r * 2, r * 2); c.fillStyle = "#fff"; c.font = F(700, r, FONT); c.textAlign = "center"; c.textBaseline = "middle"; c.fillText((data.name || data.handle || "?").trim().slice(0, 1).toUpperCase(), x, y + 2); }
    c.restore();
  };
  const chips = (c, tags, x, y, maxX, h, font, fill, ink, stroke, gap) => {
    c.font = font; c.textAlign = "left"; c.textBaseline = "alphabetic";
    for (const tg of tags.slice(0, 5)) {
      const w = c.measureText(tg).width + h * 0.85; if (x + w > maxX) break;
      rr(c, x, y, w, h, h / 2);
      if (fill) { c.fillStyle = fill; c.fill(); }
      if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1.5; c.stroke(); }
      c.fillStyle = ink; c.fillText(tg, x + h * 0.425, y + h * 0.68); x += w + gap;
    }
  };

  // ---- 年度:一整块高饱和色、超粗字、贴纸感,最适合发出去让人想转 ----
  function drawWrapped(c, d) {
    const sc = d.score.score;
    const pal = sc >= 80 ? ["#c6ff3a", "#101010", "#ff3d8b"] : sc >= 60 ? ["#ff6fb5", "#1c0b3a", "#ffe45c"] : sc >= 40 ? ["#ffb81f", "#1b1030", "#ff3d6e"] : ["#ff5148", "#1a0d0d", "#ffe45c"];
    const [bg, ink, hi] = pal;
    c.fillStyle = bg; c.fillRect(0, 0, W, H);
    // 背景几何
    c.fillStyle = ink + "14"; c.beginPath(); c.arc(W + 40, 250, 330, 0, 7); c.fill();
    c.fillStyle = ink + "0f"; c.beginPath(); c.arc(40, H - 20, 230, 0, 7); c.fill();
    c.textBaseline = "alphabetic"; c.textAlign = "left";
    // 顶部文案
    c.fillStyle = ink; c.font = F(900, 46, FONT); c.fillText("你的粉丝质量", 52, 108);
    c.font = F(900, 46, FONT); c.fillText("是这样的 ↓", 52, 164);
    // 头像贴纸
    const ax = W - 52 - 82, ay = 128;
    c.save(); c.translate(ax, ay); c.rotate(0.12); c.translate(-ax, -ay);
    circleImg(c, d, ax, ay, 78); c.strokeStyle = ink; c.lineWidth = 7; c.beginPath(); c.arc(ax, ay, 80, 0, 7); c.stroke(); c.restore();
    // 超大指数
    c.save(); c.translate(0, 0);
    c.fillStyle = ink; c.font = F(900, 400, NUM); c.fillText(String(sc), 28, 520);
    c.restore();
    // 贴纸:档位
    c.save(); c.translate(W - 190, 400); c.rotate(-0.14);
    c.font = F(900, 54, FONT); const lw = c.measureText(d.score.label).width + 64;
    rr(c, -lw / 2, -44, lw, 88, 44); c.fillStyle = hi; c.fill(); c.strokeStyle = ink; c.lineWidth = 6; c.stroke();
    c.fillStyle = ink; c.textAlign = "center"; c.fillText(d.score.label, 0, 18); c.restore();
    c.textAlign = "left"; c.fillStyle = ink; c.font = F(800, 26, FONT); c.fillText("/ 100 · 粉丝质量指数(参考)", 52, 574);
    // 名字
    c.font = F(900, 62, FONT); c.fillText(ell(c, d.name || d.handle, W - 104), 52, 676);
    c.font = F(700, 28, NUM); c.fillText("@" + d.handle + "   x.com/" + d.handle, 52, 720);
    // 数据条:粗线分隔,左标签右大数字
    const rows = [["粉丝", d.followers], ["关注", d.following], ["粉丝 / 关注比", d.ratio], ["账号年龄", ageS(d)]];
    let y = 760;
    rows.forEach(([k, v]) => {
      c.fillStyle = ink; c.fillRect(52, y, W - 104, 5);
      c.textAlign = "left"; c.font = F(800, 25, FONT); c.fillText(k, 52, y + 50);
      c.textAlign = "right"; c.font = F(900, 40, NUM); c.fillText(ell(c, String(v), 420), W - 52, y + 52);
      y += 62;
    });
    c.fillStyle = ink; c.fillRect(52, y, W - 104, 5);
    // 标签:黑底彩字
    chips(c, d.tags, 52, y + 30, W - 52, 46, F(800, 22, FONT), ink, hi === "#ffe45c" || hi === "#ff3d8b" ? "#fff" : "#fff", null, 10);
    c.textAlign = "left"; c.fillStyle = ink; c.font = F(700, 15, FONT); c.fillText("由「粉丝透镜」生成 · github.com/yaohongan/x-follower-lens · 指数为公开数据估算 · " + d.date, 52, H - 34);
  }

  // ---- 黑金:哑光黑底、金色细线和衬线数字,像一张会员/证书卡 ----
  function drawGold(c, d) {
    const sc = d.score.score;
    const gold = (x0, y0, x1, y1) => { const g = c.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, "#f7e3a3"); g.addColorStop(0.5, "#c9a24a"); g.addColorStop(1, "#8a6a22"); return g; };
    const bgg = c.createRadialGradient(W * 0.7, 160, 40, W / 2, H / 2, H * 0.8); bgg.addColorStop(0, "#1d1a14"); bgg.addColorStop(1, "#08080a");
    c.fillStyle = bgg; c.fillRect(0, 0, W, H);
    // 细纹:同心弧
    c.strokeStyle = "rgba(201,162,74,0.10)"; c.lineWidth = 1.5;
    for (let r = 120; r < 900; r += 22) { c.beginPath(); c.arc(W * 0.78, 330, r, 0, 7); c.stroke(); }
    // 双边框
    rr(c, 26, 26, W - 52, H - 52, 30); c.strokeStyle = gold(0, 0, W, H); c.lineWidth = 2.5; c.stroke();
    rr(c, 40, 40, W - 80, H - 80, 22); c.strokeStyle = "rgba(201,162,74,0.35)"; c.lineWidth = 1; c.stroke();
    c.textBaseline = "alphabetic"; c.textAlign = "left";
    spaced(c, 7, () => { c.fillStyle = gold(60, 0, 400, 0); c.font = F(700, 17, NUM); c.fillText("FOLLOWER LENS", 72, 98); c.textAlign = "right"; c.fillStyle = "rgba(247,227,163,0.7)"; c.fillText(d.date.replace(/-/g, "."), W - 72, 98); });
    c.fillStyle = "rgba(247,227,163,0.9)"; c.textAlign = "left"; c.font = F(600, 22, SERIF); c.fillText("账号体检证书", 72, 134);
    // 头像:金环
    circleImg(c, d, 72 + 84, 270, 84);
    c.strokeStyle = gold(72, 186, 240, 354); c.lineWidth = 5; c.beginPath(); c.arc(72 + 84, 270, 92, 0, 7); c.stroke();
    c.strokeStyle = "rgba(201,162,74,0.4)"; c.lineWidth = 1.5; c.beginPath(); c.arc(72 + 84, 270, 102, 0, 7); c.stroke();
    c.fillStyle = "#fff"; c.font = F(800, 50, SERIF); c.fillText(ell(c, d.name || d.handle, W - 72 - 290), 290, 262);
    c.fillStyle = gold(290, 0, 600, 0); c.font = F(600, 24, NUM); c.fillText("@" + d.handle, 290, 304);
    c.fillStyle = "rgba(255,255,255,0.6)"; c.font = F(600, 20, NUM); c.fillText(ell(c, "x.com/" + d.handle, W - 72 - 290), 290, 338);
    // 指数:衬线金色大数字 + 等级
    c.fillStyle = "rgba(201,162,74,0.5)"; c.fillRect(72, 400, W - 144, 1.5);
    c.fillStyle = gold(72, 440, 460, 700); c.font = F(700, 300, SERIF); c.fillText(String(sc), 62, 680);
    const gx = W - 72 - 160;
    c.strokeStyle = gold(gx, 460, gx + 160, 620); c.lineWidth = 3; rr(c, gx, 470, 160, 190, 18); c.stroke();
    c.textAlign = "center"; c.fillStyle = gold(gx, 480, gx + 160, 560); c.font = F(700, 120, SERIF); c.fillText(grade(sc), gx + 80, 590);
    c.fillStyle = "rgba(247,227,163,0.9)"; c.font = F(700, 24, FONT); c.fillText(d.score.label, gx + 80, 636);
    spaced(c, 4, () => { c.fillStyle = "rgba(247,227,163,0.55)"; c.font = F(600, 14, NUM); c.fillText("GRADE", gx + 80, 500); });
    c.textAlign = "left"; c.fillStyle = "rgba(255,255,255,0.55)"; c.font = F(600, 19, FONT); c.fillText("粉丝质量指数 / 100(参考)", 74, 716);
    // 四项数据:金线分隔
    c.fillStyle = "rgba(201,162,74,0.5)"; c.fillRect(72, 748, W - 144, 1.5);
    const cells = [["粉丝", d.followers], ["关注", d.following], ["粉丝 / 关注比", d.ratio], ["账号年龄", ageS(d)]];
    const cw = (W - 144) / 4;
    cells.forEach(([k, v], i) => {
      const x = 72 + i * cw;
      c.textAlign = "left"; c.fillStyle = "rgba(247,227,163,0.6)"; c.font = F(600, 16, FONT); c.fillText(k, x + (i ? 14 : 0), 790);
      c.fillStyle = "#fff"; c.font = F(700, 30, SERIF); c.fillText(ell(c, String(v), cw - 22), x + (i ? 14 : 0), 836);
      if (i) { c.fillStyle = "rgba(201,162,74,0.35)"; c.fillRect(x, 764, 1.2, 84); }
    });
    c.fillStyle = "rgba(201,162,74,0.5)"; c.fillRect(72, 868, W - 144, 1.5);
    // 得分:金色细条
    let y = 916;
    for (const p of d.score.parts) {
      c.textAlign = "left"; c.fillStyle = "rgba(255,255,255,0.85)"; c.font = F(600, 19, FONT); c.fillText(p.name, 72, y);
      const bx = 230, bw = 300; c.fillStyle = "rgba(201,162,74,0.18)"; c.fillRect(bx, y - 10, bw, 4);
      c.fillStyle = gold(bx, 0, bx + bw, 0); c.fillRect(bx, y - 10, bw * p.got / p.max, 4);
      c.fillStyle = "rgba(247,227,163,0.75)"; c.font = F(600, 16, FONT); c.fillText(`${p.got}/${p.max} · ${p.note}`, bx + bw + 16, y);
      y += 34;
    }
    chips(c, d.tags, 72, 1048, W - 72, 38, F(600, 19, FONT), null, "rgba(247,227,163,0.95)", "rgba(201,162,74,0.7)", 10);
    c.textAlign = "center"; c.fillStyle = "rgba(247,227,163,0.45)"; c.font = F(500, 13, FONT); c.fillText("由「粉丝透镜」生成 · github.com/yaohongan/x-follower-lens · 指数为公开数据估算", W / 2, H - 56);
  }
  const NEW_DRAW = { wrapped: drawWrapped, gold: drawGold };


  // data: { name, handle(主页地址 x.com/handle 由它拼出), avatar(Image|null), followers, following, ratio, ageText, score:{score,label,parts[]}, tags:[string], date }
  function draw(canvas, data, themeName) {
    canvas.width = W * S; canvas.height = H * S;
    const c = canvas.getContext("2d");
    c.scale(S, S);
    (NEW_DRAW[themeName] || NEW_DRAW.wrapped)(c, data);
  }

  window.FollowerLensCard = { draw, W, H, THEMES };
})();
