import { copyShareImage } from "./share-card.js";

const $ = (id) => document.getElementById(id);

const refreshBtn = $("refresh");
const openBtn = $("open-analytics");
const shareBtn = $("share");
const trendsBtn = $("open-trends");
const replyGoal = $("reply-goal");
const postGoal = $("post-goal");
const verifiedGoal = $("verified-goal");
const pollMinutes = $("poll-minutes");

function render(state) {
  const rg = state.replyGoal ?? 60;
  const pg = state.postGoal ?? 3;
  const vg = state.verifiedGoal ?? 500;
  replyGoal.value = rg;
  postGoal.value = pg;
  verifiedGoal.value = vg;
  pollMinutes.value = state.pollMinutes ?? 5;

  const replies = state.repliesToday;
  const posts = state.postsToday;
  const verified = state.verifiedFollowers;
  const impressions = state.verifiedImpressions;
  const officialImpressions = state.rewardsImpressions90d;
  const officialFollowers = state.rewardsVerifiedFollowers;
  const IMPRESSION_GOAL = 500_000;
  const shownImpressions = officialImpressions ?? impressions;
  $("replies-frac").textContent = `${fmt(replies)} / ${rg}`;
  $("posts-frac").textContent = `${fmt(posts)} / ${pg}`;
  $("verified-frac").textContent = `${fmt(verified)} / ${vg}`;
  $("impressions-frac").textContent = `${fmtCompact(shownImpressions)} / 500K`;
  setBar("replies-bar", replies, rg);
  setBar("posts-bar", posts, pg);
  setBar("verified-bar", verified, vg);
  setBar("impressions-bar", shownImpressions, IMPRESSION_GOAL);

  const hint = $("replies-hint");
  if (replies == null) {
    hint.textContent =
      "Waiting on the Posts/Replies chart (replies you posted). The Replies card is inbound and is ignored.";
  } else if (state.repliesReceived != null && state.repliesReceived !== replies) {
    hint.textContent = `Target: ${rg} posted / day. Analytics “Replies” card is inbound (${state.repliesReceived}) and is not counted.`;
  } else {
    hint.textContent = `Target: ${rg} replies you post / day`;
  }

  const postsHint = $("posts-hint");
  if (postsHint) {
    postsHint.textContent =
      posts == null
        ? "Waiting on the Posts/Replies chart (Posts series) or today's TweetCreate counts."
        : `Target: ${pg} posts you publish / day`;
  }

  const impHint = $("impressions-hint");
  if (impHint) {
    if (officialImpressions != null) {
      const pct = Math.min(100, (officialImpressions / IMPRESSION_GOAL) * 100);
      const left = IMPRESSION_GOAL - officialImpressions;
      const when = state.rewardsUpdatedAt ? ` · checked ${rel(state.rewardsUpdatedAt)}` : "";
      const est = impressions != null ? ` Tracker estimate ${fmtCompact(impressions)}.` : "";
      impHint.textContent =
        officialImpressions >= IMPRESSION_GOAL
          ? `Official: ${fmt(officialImpressions)} verified impressions / 90d${when} — eligible zone.${est}`
          : `Official: ${fmt(officialImpressions)} / 500K (${pct.toFixed(1)}%, ${fmt(Math.max(0, left))} to go)${when}.${est}`;
    } else if (impressions == null) {
      impHint.textContent =
        "Rewards need 500K verified Home Timeline impressions / 90 days. Waiting on analytics network captures.";
    } else {
      const pct = Math.min(100, (impressions / IMPRESSION_GOAL) * 100);
      const left = IMPRESSION_GOAL - impressions;
      const win = state.verifiedImpressionsWindowDays;
      const cov = win != null ? ` over ~${win}d of captures` : "";
      impHint.textContent =
        impressions >= IMPRESSION_GOAL
          ? `Eligible zone: ${fmt(impressions)} verified impressions${cov} (${pct.toFixed(1)}%). Official count is in Creator Studio.`
          : `${fmt(impressions)} verified Displayed${cov} — ${fmt(left)} to go (${pct.toFixed(1)}%). Estimate; replies/surfaces not excluded.`;
    }
  }

  const verifiedHint = $("verified-hint");
  if (verifiedHint) {
    verifiedHint.textContent =
      officialFollowers != null && officialFollowers !== verified
        ? `Target: 500 verified followers (rewards page shows ${fmt(officialFollowers)})`
        : "Target: 500 verified followers";
  }

  const status = $("status-line");
  if (state.status === "loading") status.textContent = "Reading x.com/i/account_analytics…";
  else if (state.status === "error") status.textContent = state.lastError || "Could not read analytics.";
  else if (state.lastSuccessAt) status.textContent = "Live from account analytics";
  else status.textContent = "Waiting for first read";

  $("replies-card").classList.toggle("error", state.status === "error");
  $("updated").textContent = state.lastSuccessAt ? `Updated ${rel(state.lastSuccessAt)}` : "";
}

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

function setBar(id, value, goal) {
  const el = $(id);
  const pct = value == null || !goal ? 0 : Math.max(0, Math.min(100, (value / goal) * 100));
  el.style.width = `${pct}%`;
  el.classList.toggle("done", value != null && value >= goal);
}

function rel(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return `${h}h ago`;
}

async function load() {
  const state = await chrome.storage.local.get(null);
  render(state);
}

refreshBtn.addEventListener("click", async () => {
  refreshBtn.disabled = true;
  $("status-line").textContent = "Refreshing…";
  try {
    const res = await chrome.runtime.sendMessage({ type: "xchrome-refresh" });
    if (res && res.state) render(res.state);
    else if (res && !res.ok) $("status-line").textContent = res.error || "Refresh failed";
  } finally {
    refreshBtn.disabled = false;
  }
});

openBtn.addEventListener("click", async () => {
  await chrome.tabs.create({ url: "https://x.com/i/account_analytics/overview" });
});

trendsBtn.addEventListener("click", async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL("trends.html") });
});

shareBtn.addEventListener("click", async () => {
  shareBtn.disabled = true;
  try {
    const state = await chrome.storage.local.get(null);
    const { outcome } = await copyShareImage(state);
    $("updated").textContent = outcome === "copied" ? "Copied — paste into X" : "Saved PNG — attach it on X";
  } catch {
    $("status-line").textContent = "Share failed — try again";
  } finally {
    shareBtn.disabled = false;
  }
});

let saveTimer = null;
function queueSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const res = await chrome.runtime.sendMessage({
      type: "xchrome-save-settings",
      settings: {
        replyGoal: replyGoal.value,
        postGoal: postGoal.value,
        verifiedGoal: verifiedGoal.value,
        pollMinutes: pollMinutes.value,
      },
    });
    if (res && res.state) render(res.state);
  }, 400);
}

replyGoal.addEventListener("change", queueSave);
postGoal.addEventListener("change", queueSave);
verifiedGoal.addEventListener("change", queueSave);
pollMinutes.addEventListener("change", queueSave);

chrome.storage.onChanged.addListener(() => load());
load();
