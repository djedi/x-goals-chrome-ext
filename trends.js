import { DEFAULTS, buildTrendSeries, summarizeTrend } from "./parse.js";
import { drawBars, drawLine } from "./charts.js";
import { copyTrendImage } from "./share-card.js";

const $ = (id) => document.getElementById(id);

let rangeDays = 30;
let lastState = null;

function fmt(n) {
  return n == null ? "—" : String(Math.round(n));
}

function fmtSigned(n) {
  if (n == null) return "—";
  const r = Math.round(n);
  return r > 0 ? `+${r}` : String(r);
}

function fmtCompact(n) {
  if (n == null) return "—";
  const v = Math.round(n);
  if (v >= 1_000_000) return `${Math.round((v / 1_000_000) * 10) / 10}M`;
  if (v >= 1000) return `${Math.round((v / 1000) * 10) / 10}K`;
  return String(v);
}

function shortDay(day) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function axisNote(series) {
  if (!series.length) return "";
  return `${shortDay(series[0].day)} → ${shortDay(series[series.length - 1].day)} · gaps are days with no read`;
}

function render(state) {
  lastState = state;
  const tz = state.timeZone || DEFAULTS.timeZone;
  const series = buildTrendSeries(state.history, rangeDays, Date.now(), tz);
  const sum = summarizeTrend(series);
  const days = Object.keys(state.history ?? {}).length;

  $("range-30").classList.toggle("on", rangeDays === 30);
  $("range-90").classList.toggle("on", rangeDays === 90);

  if (!days) {
    $("status-line").textContent = "No history yet — open X analytics to start collecting";
  } else {
    $("status-line").textContent = `${days} day${days === 1 ? "" : "s"} of history · showing last ${rangeDays}d`;
  }

  const rg = state.replyGoal ?? DEFAULTS.replyGoal;
  const pg = state.postGoal ?? DEFAULTS.postGoal;

  const repliesOk = drawBars($("chart-replies"), series.map((d) => d.replies), { goal: rg });
  $("replies-total").textContent = `${fmt(sum.totalReplies)} total`;
  $("replies-note").textContent = repliesOk
    ? `${sum.repliesDays}d with data · goal ${rg}/day · ${axisNote(series)}`
    : `No reply data in this range · ${axisNote(series)}`;

  const postsOk = drawBars($("chart-posts"), series.map((d) => d.posts), { goal: pg });
  $("posts-total").textContent = `${fmt(sum.totalPosts)} total`;
  $("posts-note").textContent = postsOk
    ? `${sum.postsDays}d with data · goal ${pg}/day · ${axisNote(series)}`
    : `No post data in this range · ${axisNote(series)}`;

  const verifiedValues = series.map((d) => d.verified ?? d.rewardsVerified);
  const verifiedOk = drawLine($("chart-verified"), verifiedValues);
  const verifiedPts = verifiedValues.filter((v) => v != null);
  const verifiedDelta =
    verifiedPts.length > 1 ? verifiedPts[verifiedPts.length - 1] - verifiedPts[0] : null;
  $("verified-delta").textContent = verifiedPts.length ? fmtSigned(verifiedDelta ?? 0) : "—";
  $("verified-note").textContent = verifiedOk
    ? `${fmt(verifiedPts[0])} → ${fmt(verifiedPts[verifiedPts.length - 1])} · ${axisNote(series)}`
    : `No verified-follower reads in this range · ${axisNote(series)}`;

  const official = series.map((d) => d.rewardsImpressions);
  const useOfficial = official.some((v) => v != null);
  const impValues = useOfficial ? official : series.map((d) => d.impressions);
  const impOk = drawLine($("chart-impressions"), impValues, { color: useOfficial ? "#00ba7c" : "#1d9bf0" });
  const lastImp = impValues.filter((v) => v != null).pop() ?? null;
  $("impressions-last").textContent = fmtCompact(lastImp);
  $("impressions-note").textContent = impOk
    ? useOfficial
      ? `Official rewards 90d count · ${axisNote(series)}`
      : `Tracker estimate from captures · ${axisNote(series)}`
    : `No impression data in this range · ${axisNote(series)}`;

  $("updated").textContent = state.lastSuccessAt
    ? `Last read ${rel(state.lastSuccessAt)}`
    : "";
}

function rel(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

async function load() {
  const state = await chrome.storage.local.get(null);
  render(state);
}

$("range-30").addEventListener("click", () => {
  rangeDays = 30;
  if (lastState) render(lastState);
});

$("range-90").addEventListener("click", () => {
  rangeDays = 90;
  if (lastState) render(lastState);
});

$("share-trends").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    const state = await chrome.storage.local.get(null);
    const { outcome } = await copyTrendImage(state, rangeDays);
    $("share-note").textContent = outcome === "copied" ? "Copied — paste into X" : "Saved PNG — attach it on X";
  } catch {
    $("share-note").textContent = "Share failed — try again";
  } finally {
    btn.disabled = false;
  }
});

let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (lastState) render(lastState);
  }, 200);
});

chrome.storage.onChanged.addListener(() => load());
load();
