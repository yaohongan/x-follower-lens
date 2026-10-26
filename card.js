// 账号名片:用 Canvas 画一张"粉丝质量体检卡"图片。纯绘图,不读页面、不联网(头像由调用方传入)。
(() => {
  const W = 800, H = 1120, S = 2;   // 逻辑尺寸;实际像素 ×2,发到 X 上更清晰
  const FONT = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif';

  const rr = (c, x, y, w, h, r) => { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); };
  const scoreColors = (s) => (s >= 80 ? ["#34d399", "#22d3ee"] : s >= 60 ? ["#60a5fa", "#a78bfa"] : s >= 40 ? ["#fbbf24", "#fb923c"] : ["#f87171", "#fb7185"]);
  const ell = (c, text, maxW) => { if (c.measureText(text).width <= maxW) return text; let t = text; while (t.length > 1 && c.measureText(t + "…").width > maxW) t = t.slice(0, -1); return t + "…"; };

  // data: { name, handle, avatar(Image|null), followers, following, ratio, ageText, score:{score,label,parts[]}, tags:[string], date }
  function draw(canvas, data) {
    canvas.width = W * S; canvas.height = H * S;
    const c = canvas.getContext("2d");
    c.scale(S, S);
    const [c1, c2] = scoreColors(data.score.score);

    // 背景:深色渐变 + 两团柔光
    const bg = c.createLinearGradient(0, 0, W, H); bg.addColorStop(0, "#0b1020"); bg.addColorStop(1, "#1a1240");
    c.fillStyle = bg; c.fillRect(0, 0, W, H);
    for (const [x, y, r, col] of [[W * 0.85, 120, 360, c1 + "33"], [80, H - 140, 340, c2 + "26"]]) {
      const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, col); g.addColorStop(1, "transparent"); c.fillStyle = g; c.fillRect(0, 0, W, H);
    }

    // 顶栏
    c.textBaseline = "alphabetic";
    c.fillStyle = "rgba(255,255,255,0.9)"; c.font = `700 24px ${FONT}`; c.textAlign = "left"; c.fillText("🔍 粉丝透镜 · 账号体检卡", 48, 70);
    c.fillStyle = "rgba(255,255,255,0.45)"; c.font = `500 20px ${FONT}`; c.textAlign = "right"; c.fillText(data.date, W - 48, 70);

    // 头像 + 名字
    const ax = 48 + 56, ay = 190, ar = 56;
    c.save(); c.beginPath(); c.arc(ax, ay, ar, 0, Math.PI * 2); c.clip();
    if (data.avatar) c.drawImage(data.avatar, ax - ar, ay - ar, ar * 2, ar * 2);
    else { c.fillStyle = "#334155"; c.fillRect(ax - ar, ay - ar, ar * 2, ar * 2); c.fillStyle = "#fff"; c.font = `700 56px ${FONT}`; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText((data.name || data.handle || "?").trim().slice(0, 1).toUpperCase(), ax, ay + 2); c.textBaseline = "alphabetic"; }
    c.restore();
    const rg = c.createLinearGradient(ax - ar, ay - ar, ax + ar, ay + ar); rg.addColorStop(0, c1); rg.addColorStop(1, c2);
    c.strokeStyle = rg; c.lineWidth = 5; c.beginPath(); c.arc(ax, ay, ar + 6, 0, Math.PI * 2); c.stroke();
    c.textAlign = "left"; c.fillStyle = "#fff"; c.font = `800 42px ${FONT}`; c.fillText(ell(c, data.name || data.handle, 540), 190, 186);
    c.fillStyle = "rgba(255,255,255,0.55)"; c.font = `500 26px ${FONT}`; c.fillText("@" + data.handle, 190, 226);

    // 大数字:质量指数(圆环)
    const cx = W / 2, cy = 430, R = 118;
    c.lineWidth = 22; c.lineCap = "round"; c.strokeStyle = "rgba(255,255,255,0.1)"; c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.stroke();
    const sg = c.createLinearGradient(cx - R, cy - R, cx + R, cy + R); sg.addColorStop(0, c1); sg.addColorStop(1, c2);
    c.strokeStyle = sg; c.beginPath(); c.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.02, data.score.score / 100)); c.stroke();
    c.textAlign = "center"; c.fillStyle = "#fff"; c.font = `800 96px ${FONT}`; c.fillText(String(data.score.score), cx, cy + 22);
    c.fillStyle = c1; c.font = `700 28px ${FONT}`; c.fillText(data.score.label, cx, cy + 66);
    c.fillStyle = "rgba(255,255,255,0.5)"; c.font = `500 20px ${FONT}`; c.fillText("粉丝质量指数 / 100(参考)", cx, cy + R + 52);

    // 四格数字
    const tiles = [["粉丝", data.followers], ["关注", data.following], ["粉丝 / 关注比", data.ratio], ["账号年龄", data.ageText]];
    const tw = (W - 96 - 20) / 2, th = 96;
    tiles.forEach(([k, v], i) => {
      const x = 48 + (i % 2) * (tw + 20), y = 640 + Math.floor(i / 2) * (th + 16);
      rr(c, x, y, tw, th, 20); c.fillStyle = "rgba(255,255,255,0.07)"; c.fill();
      c.textAlign = "left"; c.fillStyle = "rgba(255,255,255,0.55)"; c.font = `500 20px ${FONT}`; c.fillText(k, x + 24, y + 34);
      c.fillStyle = "#fff"; c.font = `800 36px ${FONT}`; c.fillText(ell(c, String(v), tw - 48), x + 24, y + 76);
    });

    // 四项得分条
    let y = 892;
    for (const p of data.score.parts) {
      c.textAlign = "left"; c.fillStyle = "rgba(255,255,255,0.85)"; c.font = `600 20px ${FONT}`; c.fillText(p.name, 48, y);
      const bx = 190, bw = 360;
      rr(c, bx, y - 14, bw, 12, 6); c.fillStyle = "rgba(255,255,255,0.1)"; c.fill();
      rr(c, bx, y - 14, Math.max(12, bw * p.got / p.max), 12, 6); c.fillStyle = sg; c.fill();
      c.fillStyle = "rgba(255,255,255,0.55)"; c.font = `500 18px ${FONT}`; c.textAlign = "left"; c.fillText(p.note, bx + bw + 18, y);
      y += 34;
    }

    // 标签
    let x = 48; const ty = 1084;
    c.font = `600 20px ${FONT}`;
    for (const t of data.tags.slice(0, 5)) {
      const w = c.measureText(t).width + 28; if (x + w > W - 48) break;
      rr(c, x, ty - 62, w, 36, 18); c.fillStyle = "rgba(255,255,255,0.12)"; c.fill();
      c.fillStyle = "#fff"; c.textAlign = "left"; c.fillText(t, x + 14, ty - 37); x += w + 10;
    }
    // 页脚
    c.textAlign = "center"; c.fillStyle = "rgba(255,255,255,0.35)"; c.font = `500 17px ${FONT}`;
    c.fillText("由「粉丝透镜」生成 · github.com/yaohongan/x-follower-lens · 指数为公开数据估算", W / 2, H - 16);
  }

  window.FollowerLensCard = { draw, W, H };
})();
