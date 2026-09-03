const $ = (id) => document.getElementById(id);

const refreshBtn = $("refresh");
const openBtn = $("open-analytics");
const replyGoal = $("reply-goal");
const verifiedGoal = $("verified-goal");
const pollMinutes = $("poll-minutes");

function render(state) {
  const rg = state.replyGoal ?? 60;
  const vg = state.verifiedGoal ?? 500;
  replyGoal.value = rg;
  verifiedGoal.value = vg;
  pollMinutes.value = state.pollMinutes ?? 5;

  const replies = state.repliesToday;
  const verified = state.verifiedFollowers;
  $("replies-frac").textContent = `${fmt(replies)} / ${rg}`;
  $("verified-frac").textContent = `${fmt(verified)} / ${vg}`;
  setBar("replies-bar", replies, rg);
  setBar("verified-bar", verified, vg);

  const hint = $("replies-hint");
  if (replies == null) {
    hint.textContent =
      "Waiting on the Posts/Replies chart (replies you posted). The Replies card is inbound and is ignored.";
  } else if (state.repliesReceived != null && state.repliesReceived !== replies) {
    hint.textContent = `Target: ${rg} posted / day. Analytics “Replies” card is inbound (${state.repliesReceived}) and is not counted.`;
  } else {
    hint.textContent = `Target: ${rg} replies you post / day`;
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

let saveTimer = null;
function queueSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const res = await chrome.runtime.sendMessage({
      type: "xchrome-save-settings",
      settings: {
        replyGoal: replyGoal.value,
        verifiedGoal: verifiedGoal.value,
        pollMinutes: pollMinutes.value,
      },
    });
    if (res && res.state) render(res.state);
  }, 400);
}

replyGoal.addEventListener("change", queueSave);
verifiedGoal.addEventListener("change", queueSave);
pollMinutes.addEventListener("change", queueSave);

chrome.storage.onChanged.addListener(() => load());
load();
