import { DEFAULTS, buildTrendSeries, summarizeTrend } from "./parse.js";

const W = 1200;
const H = 675;

function fmt(n) {
  return n == null ? "—" : String(Math.round(n));
}

function fmtCompact(n) {
  if (n == null) return "—";
  const v = Math.round(n);
  if (v >= 1_000_000) return `${Math.round((v / 1_000_000) * 10) / 10}M`;
  if (v >= 1000) return `${Math.round((v / 1000) * 10) / 10}K`;
  return String(v);
}

function metrics(state) {
  const rg = state.replyGoal ?? 60;
  const pg = state.postGoal ?? 3;
  const vg = state.verifiedGoal ?? 500;
  const ig = 500_000;
  const shownImpressions = state.rewardsImpressions90d ?? state.verifiedImpressions;
  return [
    { label: "Replies posted", value: state.repliesToday, goal: rg, frac: `${fmt(state.repliesToday)} / ${rg}` },
    { label: "Posts published", value: state.postsToday, goal: pg, frac: `${fmt(state.postsToday)} / ${pg}` },
    { label: "Verified followers", value: state.verifiedFollowers, goal: vg, frac: `${fmt(state.verifiedFollowers)} / ${vg}` },
    { label: "Verified impressions", value: shownImpressions, goal: ig, frac: `${fmtCompact(shownImpressions)} / 500K`, compact: true },
  ];
}

function rr(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function buildShareCanvas(state, doc = document) {
  const canvas = doc.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "#e7e9ea";
  ctx.font = "800 64px ui-sans-serif, system-ui, -apple-system, sans-serif";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("𝕏 Goals", 64, 108);

  const date = new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  ctx.fillStyle = "#8b98a5";
  ctx.font = "600 30px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(date, W - 64, 100);
  ctx.textAlign = "left";

  const rows = metrics(state);
  const cardX = 64;
  const cardW = W - 128;
  const cardH = 104;
  const gap = 16;
  let y = 140;

  for (const row of rows) {
    ctx.fillStyle = "#16181c";
    rr(ctx, cardX, y, cardW, cardH, 20);
    ctx.fill();
    ctx.strokeStyle = "#2f3336";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = "#8b98a5";
    ctx.font = "600 26px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText(row.label, cardX + 28, y + 42);

    ctx.fillStyle = "#e7e9ea";
    ctx.font = "800 30px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(row.frac, cardX + cardW - 28, y + 44);
    ctx.textAlign = "left";

    const bx = cardX + 28;
    const bw = cardW - 56;
    const by = y + 62;
    const bh = 14;
    ctx.fillStyle = "#2f3336";
    rr(ctx, bx, by, bw, bh, bh / 2);
    ctx.fill();
    const pct = row.value == null || !row.goal ? 0 : Math.max(0, Math.min(1, row.value / row.goal));
    if (pct > 0) {
      ctx.fillStyle = pct >= 1 ? "#00ba7c" : "#1d9bf0";
      rr(ctx, bx, by, Math.max(bh, bw * pct), bh, bh / 2);
      ctx.fill();
    }
    y += cardH + gap;
  }

  const rg = state.replyGoal ?? DEFAULTS.replyGoal;
  const pg = state.postGoal ?? DEFAULTS.postGoal;
  const vg = state.verifiedGoal ?? DEFAULTS.verifiedGoal;
  ctx.fillStyle = "#536471";
  ctx.font = "500 24px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(`Goals: ${rg} replies/d · ${pg} posts/d · ${vg} verified followers`, 64, H - 28);

  ctx.fillStyle = "#1d9bf0";
  ctx.font = "700 26px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText("Get 𝕏 Goals → XGoals.top", W - 64, H - 28);
  ctx.textAlign = "left";

  return canvas;
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not render image"))), "image/png");
  });
}

function downloadBlob(blob, doc = document, prefix = "x-goals") {
  const url = URL.createObjectURL(blob);
  const a = doc.createElement("a");
  const day = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `${prefix}-${day}.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function copyShareImage(state, doc = document, nav = navigator) {
  const canvas = buildShareCanvas(state, doc);
  const blob = await canvasBlob(canvas);
  try {
    await nav.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return { outcome: "copied" };
  } catch {
    downloadBlob(blob, doc, "x-goals");
    return { outcome: "downloaded" };
  }
}

function shortDay(day) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function buildTrendCanvas(state, days = 30, doc = document) {
  const tz = state.timeZone || DEFAULTS.timeZone;
  const series = buildTrendSeries(state.history, days, Date.now(), tz);
  const sum = summarizeTrend(series);
  const rg = state.replyGoal ?? DEFAULTS.replyGoal;

  const canvas = doc.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "#e7e9ea";
  ctx.font = "800 60px ui-sans-serif, system-ui, -apple-system, sans-serif";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("𝕏 Goals", 64, 100);

  ctx.fillStyle = "#8b98a5";
  ctx.font = "600 28px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "right";
  const range = series.length ? `${shortDay(series[0].day)} – ${shortDay(series[series.length - 1].day)}` : "";
  ctx.fillText(range, W - 64, 94);
  ctx.textAlign = "left";

  const vDelta = sum.verifiedDelta;
  const stats = `${fmt(sum.totalReplies)} replies · ${fmt(sum.totalPosts)} posts · ${vDelta == null ? "—" : (vDelta > 0 ? `+${Math.round(vDelta)}` : String(Math.round(vDelta)))} verified / ${series.length}d`;
  ctx.fillStyle = "#e7e9ea";
  ctx.font = "700 40px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(stats, 64, 168);

  const cx = 64;
  const cw = W - 128;
  const cy = 210;
  const ch = 330;
  ctx.fillStyle = "#16181c";
  rr(ctx, cx, cy - 20, cw, ch + 70, 20);
  ctx.fill();
  ctx.strokeStyle = "#2f3336";
  ctx.lineWidth = 2;
  ctx.stroke();

  const values = series.map((d) => d.replies);
  const nums = values.filter((v) => v != null);
  const max = Math.max(rg, ...nums, 1);
  const n = values.length;
  const slot = cw - 56 > 0 ? (cw - 56) / Math.max(1, n) : 0;
  const bw = Math.max(2, Math.min(22, slot * 0.62));
  values.forEach((v, i) => {
    if (v == null) return;
    const bh = Math.max(3, (v / max) * ch);
    ctx.fillStyle = v >= rg ? "#00ba7c" : "#1d9bf0";
    const x = cx + 28 + slot * i + (slot - bw) / 2;
    ctx.beginPath();
    ctx.roundRect(x, cy + ch - bh, bw, bh, Math.min(4, bw / 2));
    ctx.fill();
  });

  if (rg <= max) {
    const gy = cy + ch - (rg / max) * ch;
    ctx.strokeStyle = "#00ba7c";
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(cx + 28, gy);
    ctx.lineTo(cx + cw - 28, gy);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#00ba7c";
    ctx.font = "600 22px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(`goal ${rg}/d`, cx + cw - 28, gy - 8);
    ctx.textAlign = "left";
  }

  ctx.fillStyle = "#8b98a5";
  ctx.font = "600 24px ui-sans-serif, system-ui, sans-serif";
  if (series.length) {
    ctx.fillText(shortDay(series[0].day), cx + 28, cy + ch + 36);
    ctx.textAlign = "right";
    ctx.fillText(shortDay(series[series.length - 1].day), cx + cw - 28, cy + ch + 36);
    ctx.textAlign = "left";
  }

  ctx.fillStyle = "#536471";
  ctx.font = "500 24px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(`Replies per day · last ${series.length}d`, 64, H - 28);

  ctx.fillStyle = "#1d9bf0";
  ctx.font = "700 26px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText("Get 𝕏 Goals → XGoals.top", W - 64, H - 28);
  ctx.textAlign = "left";

  return canvas;
}

export async function copyTrendImage(state, days = 30, doc = document, nav = navigator) {
  const canvas = buildTrendCanvas(state, days, doc);
  const blob = await canvasBlob(canvas);
  try {
    await nav.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return { outcome: "copied" };
  } catch {
    downloadBlob(blob, doc, "x-goals-trends");
    return { outcome: "downloaded" };
  }
}
