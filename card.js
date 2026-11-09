// 账号名片:用 Canvas 画一张"粉丝质量体检卡"图片。纯绘图,不读页面、不联网(头像由调用方传入)。
// 三套风格:bento 便当(默认,浅灰底 + 圆角格子)/ poster 海报(纸色底 + 超大数字)/ gold 黑金(哑光黑底 + 金色线条与衬线数字)。
(() => {
  const W = 800, H = 1180, S = 2;   // 逻辑尺寸;实际像素 ×2,发到 X 上更清晰
  const FONT = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif';
  const THEMES = [["bento", "便当"], ["poster", "海报"], ["gold", "黑金"]];

  const accent = (s) => (s >= 80 ? ["#10b981", "#06b6d4"] : s >= 60 ? ["#6366f1", "#ec4899"] : s >= 40 ? ["#f59e0b", "#ef4444"] : ["#ef4444", "#be185d"]);
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

  // ---- 海报:纸色底、超大数字、细线分栏,像杂志的一页 ----
  function drawPoster(c, d) {
    const sc = d.score.score, [a1, a2] = accent(sc), ink = "#16130f", sub = "rgba(22,19,15,0.5)", line = "rgba(22,19,15,0.85)";
    c.fillStyle = "#f3efe6"; c.fillRect(0, 0, W, H);
    c.fillStyle = a1 + "22"; c.beginPath(); c.arc(W - 40, 700, 300, 0, 7); c.fill();           // 淡淡的色块,压在数字后面
    c.textBaseline = "alphabetic";
    // 刊头
    spaced(c, 5, () => { c.fillStyle = ink; c.font = F(800, 17, NUM); c.textAlign = "left"; c.fillText("ACCOUNT CHECK", 52, 68); c.textAlign = "right"; c.fillText(d.date.replace(/-/g, " . "), W - 52, 68); });
    c.fillStyle = line; c.fillRect(52, 86, W - 104, 3);
    // 头像 + 名字
    circleImg(c, d, W - 52 - 74, 196, 74);
    c.strokeStyle = ink; c.lineWidth = 4; c.beginPath(); c.arc(W - 52 - 74, 196, 80, 0, 7); c.stroke();
    c.textAlign = "left"; c.fillStyle = ink; c.font = F(900, 60, FONT); c.fillText(ell(c, d.name || d.handle, W - 52 - 200 - 60), 52, 190);
    c.fillStyle = sub; c.font = F(600, 26, NUM); c.fillText("@" + d.handle, 52, 232);
    c.fillStyle = ink; c.font = F(700, 22, NUM); c.fillText(ell(c, "x.com/" + d.handle, 440), 52, 268);
    // 超大指数
    c.fillStyle = ink; c.font = F(900, 360, NUM); c.textAlign = "left";
    const nw = c.measureText(String(sc)).width;
    c.fillText(String(sc), 38, 566);
    c.fillStyle = a1; c.fillRect(52, 592, Math.min(nw, 420), 14);
    c.fillStyle = ink; c.font = F(800, 34, NUM); c.fillText("/ 100", 52 + nw + 6 > 560 ? 560 : 52 + nw + 6, 566);
    // 档位标签(实心色块)
    c.font = F(900, 40, FONT); const lw = c.measureText(d.score.label).width + 56;
    const lx = W - 52 - lw, ly = 400;
    rr(c, lx, ly, lw, 68, 12); c.fillStyle = a1; c.fill(); c.fillStyle = "#fff"; c.textAlign = "center"; c.fillText(d.score.label, lx + lw / 2, ly + 49);
    c.textAlign = "right"; c.fillStyle = sub; c.font = F(600, 19, FONT); c.fillText("粉丝质量指数(参考)", W - 52, ly + 100);
    // 四项数据:两列,细线分隔
    c.fillStyle = line; c.fillRect(52, 636, W - 104, 3);
    const cells = [["粉丝", d.followers], ["关注", d.following], ["粉丝 / 关注比", d.ratio], ["账号年龄", ageS(d)]];
    const cw = (W - 104) / 2;
    cells.forEach(([k, v], i) => {
      const x = 52 + (i % 2) * cw, y = 642 + Math.floor(i / 2) * 108;
      c.textAlign = "left"; c.fillStyle = sub; c.font = F(600, 18, FONT); c.fillText(k, x + (i % 2 ? 26 : 0), y + 36);
      c.fillStyle = ink; c.font = F(800, 46, NUM); c.fillText(ell(c, String(v), cw - 40), x + (i % 2 ? 26 : 0), y + 90);
      if (i % 2 === 0) c.fillRect(x + cw - 1, y + 14, 1.5, 84);
    });
    c.fillStyle = line; c.fillRect(52, 642 + 108, W - 104, 1.5);
    c.fillRect(52, 642 + 216, W - 104, 3);
    // 得分
    let y = 916;
    for (const p of d.score.parts) {
      c.textAlign = "left"; c.fillStyle = ink; c.font = F(700, 20, FONT); c.fillText(p.name, 52, y);
      c.fillStyle = sub; c.font = F(500, 17, FONT); c.fillText(p.note, 52 + c.measureText(p.name).width + 14 + 6, y);
      c.textAlign = "right"; c.fillStyle = ink; c.font = F(800, 22, NUM); c.fillText(`${p.got}`, W - 52 - 38, y); c.fillStyle = sub; c.font = F(600, 17, NUM); c.fillText(`/${p.max}`, W - 52, y);
      c.fillStyle = "rgba(22,19,15,0.12)"; c.fillRect(52, y + 12, W - 104, 5); c.fillStyle = a1; c.fillRect(52, y + 12, (W - 104) * p.got / p.max, 5);
      y += 42;
    }
    chips(c, d.tags, 52, 1082, W - 52, 38, F(700, 19, FONT), null, ink, ink, 10);
    c.textAlign = "left"; c.fillStyle = sub; c.font = F(500, 14, FONT); c.fillText("由「粉丝透镜」生成 · github.com/yaohongan/x-follower-lens · 指数为公开数据估算", 52, H - 22);
  }

  // ---- 便当:浅灰底 + 大小不一的圆角格子,一格一个数据,只有指数那格有颜色 ----
  function drawBento(c, d) {
    const sc = d.score.score, [a1, a2] = accent(sc), ink = "#12141a", sub = "rgba(18,20,26,0.5)";
    c.fillStyle = "#e8ebf1"; c.fillRect(0, 0, W, H);
    const P = 36, G = 16, R = 34;
    const tile = (x, y, w, h, fill, r) => { c.save(); c.shadowColor = "rgba(30,40,70,0.10)"; c.shadowBlur = 24; c.shadowOffsetY = 8; rr(c, x, y, w, h, r || R); c.fillStyle = fill || "#fff"; c.fill(); c.restore(); };
    c.textBaseline = "alphabetic"; c.textAlign = "left";
    // 身份格
    tile(P, P, W - 2 * P, 208);
    circleImg(c, d, P + 44 + 64, P + 104, 64);
    const g = c.createLinearGradient(P + 44, P + 40, P + 172, P + 168); g.addColorStop(0, a1); g.addColorStop(1, a2);
    c.strokeStyle = g; c.lineWidth = 6; c.beginPath(); c.arc(P + 44 + 64, P + 104, 71, 0, 7); c.stroke();
    c.fillStyle = ink; c.font = F(800, 42, FONT); c.fillText(ell(c, d.name || d.handle, 430), P + 208, P + 92);
    c.fillStyle = sub; c.font = F(600, 24, NUM); c.fillText("@" + d.handle, P + 208, P + 130);
    c.fillStyle = a1; c.font = F(700, 22, NUM); c.fillText(ell(c, "x.com/" + d.handle, 430), P + 208, P + 166);
    // 指数格(大,彩色)
    const y2 = P + 208 + G, sw = 350, sh = 352;
    tile(P, y2, sw, sh, "#fff");
    const gg = c.createLinearGradient(P, y2, P + sw, y2 + sh); gg.addColorStop(0, a1); gg.addColorStop(1, a2);
    rr(c, P, y2, sw, sh, R); c.fillStyle = gg; c.fill();
    c.save(); rr(c, P, y2, sw, sh, R); c.clip(); c.fillStyle = "rgba(255,255,255,0.18)"; c.beginPath(); c.arc(P + sw - 20, y2 + 40, 130, 0, 7); c.fill(); c.restore();
    c.fillStyle = "rgba(255,255,255,0.85)"; c.font = F(700, 20, FONT); c.fillText("粉丝质量指数", P + 32, y2 + 52);
    c.fillStyle = "#fff"; c.font = F(900, 170, NUM); c.fillText(String(sc), P + 24, y2 + 232);
    c.font = F(800, 30, FONT); const lw = c.measureText(d.score.label).width + 36;
    rr(c, P + 32, y2 + 262, lw, 52, 26); c.fillStyle = "rgba(255,255,255,0.95)"; c.fill(); c.fillStyle = a1; c.fillText(d.score.label, P + 50, y2 + 299);
    // 右侧两格:粉丝 / 关注
    const rx = P + sw + G, rw = W - P - rx, rh = (sh - G) / 2;
    [["粉丝", d.followers], ["关注", d.following]].forEach(([k, v], i) => {
      const y = y2 + i * (rh + G); tile(rx, y, rw, rh);
      c.fillStyle = sub; c.font = F(600, 20, FONT); c.fillText(k, rx + 30, y + 46);
      c.fillStyle = ink; c.font = F(800, 58, NUM); c.fillText(ell(c, String(v), rw - 60), rx + 30, y + 118);
    });
    // 三小格
    const y3 = y2 + sh + G, tw3 = (W - 2 * P - 2 * G) / 3, th3 = 128;
    [["粉丝/关注比", d.ratio], ["账号年龄", ageS(d)], ["推文", d.score.parts[3].note]].forEach(([k, v], i) => {
      const x = P + i * (tw3 + G); tile(x, y3, tw3, th3, "#fff");
      c.fillStyle = sub; c.font = F(600, 18, FONT); c.fillText(k, x + 26, y3 + 40);
      c.fillStyle = ink; c.font = F(800, 34, NUM); c.fillText(ell(c, String(v), tw3 - 44), x + 26, y3 + 92);
    });
    // 得分格
    const y4 = y3 + th3 + G, h4 = 236; tile(P, y4, W - 2 * P, h4);
    let y = y4 + 56;
    for (const p of d.score.parts) {
      c.textAlign = "left"; c.fillStyle = ink; c.font = F(700, 20, FONT); c.fillText(p.name, P + 30, y);
      const bx = P + 190, bw = 300; rr(c, bx, y - 14, bw, 14, 7); c.fillStyle = "#e8ebf1"; c.fill();
      const bgd = c.createLinearGradient(bx, 0, bx + bw, 0); bgd.addColorStop(0, a1); bgd.addColorStop(1, a2);
      rr(c, bx, y - 14, Math.max(14, bw * p.got / p.max), 14, 7); c.fillStyle = bgd; c.fill();
      c.fillStyle = sub; c.font = F(600, 17, FONT); c.fillText(`${p.got}/${p.max} · ${p.note}`, bx + bw + 16, y);
      y += 44;
    }
    // 标签格
    const y5 = y4 + h4 + G, h5 = H - y5 - 62; tile(P, y5, W - 2 * P, h5);
    chips(c, d.tags, P + 30, y5 + (h5 - 40) / 2, W - P - 20, 40, F(700, 20, FONT), "#eef1f6", ink, null, 10);
    c.textAlign = "center"; c.fillStyle = sub; c.font = F(500, 15, FONT); c.fillText("由「粉丝透镜」生成 · github.com/yaohongan/x-follower-lens · 指数为公开数据估算 · " + d.date, W / 2, H - 24);
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
  const NEW_DRAW = { bento: drawBento, poster: drawPoster, gold: drawGold };


  // data: { name, handle(主页地址 x.com/handle 由它拼出), avatar(Image|null), followers, following, ratio, ageText, score:{score,label,parts[]}, tags:[string], date }
  function draw(canvas, data, themeName) {
    canvas.width = W * S; canvas.height = H * S;
    const c = canvas.getContext("2d");
    c.scale(S, S);
    (NEW_DRAW[themeName] || NEW_DRAW.bento)(c, data);
  }

  window.FollowerLensCard = { draw, W, H, THEMES };
})();
