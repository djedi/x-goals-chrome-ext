export function fitCanvas(canvas, cssHeight) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(50, canvas.clientWidth || canvas.parentElement.clientWidth || 300);
  const h = cssHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

const PAD = { l: 8, r: 8, t: 10, b: 4 };

export function drawBars(canvas, values, options = {}) {
  const { color = "#1d9bf0", goal = null, cssHeight = 120 } = options;
  const { ctx, w, h } = fitCanvas(canvas, cssHeight);
  ctx.clearRect(0, 0, w, h);
  const iw = w - PAD.l - PAD.r;
  const ih = h - PAD.t - PAD.b;
  const nums = values.filter((v) => v != null);
  if (!nums.length) return false;
  const max = Math.max(goal ?? 0, ...nums, 1);
  const n = values.length;
  const slot = iw / n;
  const bw = Math.max(2, Math.min(18, slot * 0.62));
  values.forEach((v, i) => {
    if (v == null) return;
    const bh = Math.max(2, (v / max) * ih);
    ctx.fillStyle = goal != null && v >= goal ? "#00ba7c" : color;
    const x = PAD.l + slot * i + (slot - bw) / 2;
    ctx.beginPath();
    ctx.roundRect(x, PAD.t + ih - bh, bw, bh, Math.min(3, bw / 2));
    ctx.fill();
  });
  if (goal != null && goal <= max) {
    const y = PAD.t + ih - (goal / max) * ih;
    ctx.strokeStyle = "#00ba7c";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(PAD.l, y);
    ctx.lineTo(w - PAD.r, y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  return true;
}

export function drawLine(canvas, values, options = {}) {
  const { color = "#1d9bf0", cssHeight = 120 } = options;
  const { ctx, w, h } = fitCanvas(canvas, cssHeight);
  ctx.clearRect(0, 0, w, h);
  const pts = values.map((v) => v).filter((v) => v != null);
  if (pts.length < 1) return false;
  const iw = w - PAD.l - PAD.r;
  const ih = h - PAD.t - PAD.b;
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  const span = hi - lo || 1;
  const n = values.length;
  const x = (i) => PAD.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v) => PAD.t + ih - ((v - lo) / span) * ih;
  const segments = [];
  let cur = [];
  values.forEach((v, i) => {
    if (v == null) {
      if (cur.length) segments.push(cur);
      cur = [];
      return;
    }
    cur.push(i);
  });
  if (cur.length) segments.push(cur);
  const grad = ctx.createLinearGradient(0, PAD.t, 0, PAD.t + ih);
  grad.addColorStop(0, "rgba(29,155,240,0.30)");
  grad.addColorStop(1, "rgba(29,155,240,0.02)");
  for (const seg of segments) {
    if (seg.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(x(seg[0]), y(values[seg[0]]));
    for (const i of seg.slice(1)) ctx.lineTo(x(i), y(values[i]));
    ctx.save();
    ctx.lineTo(x(seg[seg.length - 1]), PAD.t + ih);
    ctx.lineTo(x(seg[0]), PAD.t + ih);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = "round";
  for (const seg of segments) {
    if (seg.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(x(seg[0]), y(values[seg[0]]));
    for (const i of seg.slice(1)) ctx.lineTo(x(i), y(values[i]));
    ctx.stroke();
  }
  ctx.fillStyle = color;
  values.forEach((v, i) => {
    if (v == null) return;
    ctx.beginPath();
    ctx.arc(x(i), y(v), 3, 0, Math.PI * 2);
    ctx.fill();
  });
  return true;
}
