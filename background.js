import { DEFAULTS, dayKey } from "./parse.js";
import { scrapeAnalytics } from "./scrape.js";

const ALARM = "xchrome-poll";
const ANALYTICS_URL = "https://x.com/i/account_analytics/overview";
const TAB_URLS = [
  "https://x.com/i/account_analytics*",
  "https://twitter.com/i/account_analytics*",
];

let scrapeInFlight = null;
let lastScrapeAt = 0;

function debug(event, details = {}) {
  console.info(`[X Goals] ${event}`, details);
}

chrome.runtime.onInstalled.addListener(async () => {
  await ensureDefaults();
  await syncAlarm();
  collect({ reason: "install" }).catch(() => {});
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureDefaults();
  await syncAlarm();
  collect({ reason: "startup" }).catch(() => {});
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) collect({ reason: "alarm" }).catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== "string") return undefined;
  if (msg.type === "xchrome-refresh") {
    collect({ reason: "popup", force: true })
      .then((state) => sendResponse({ ok: true, state }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (msg.type === "xchrome-page-ready") {
    const tabId = sender.tab && sender.tab.id;
    collect({ reason: "page", tabId, force: false }).catch(() => {});
    return false;
  }
  if (msg.type === "xchrome-save-settings") {
    saveSettings(msg.settings)
      .then((state) => sendResponse({ ok: true, state }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  return undefined;
});

async function ensureDefaults() {
  const current = await chrome.storage.local.get(null);
  const patch = {};
  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (current[key] == null) patch[key] = value;
  }
  if (current.verifiedFollowers === undefined) patch.verifiedFollowers = null;
  if (current.repliesToday === undefined) patch.repliesToday = null;
  if (current.status === undefined) patch.status = "idle";
  if (Object.keys(patch).length) await chrome.storage.local.set(patch);
}

async function saveSettings(settings) {
  const replyGoal = clampInt(settings.replyGoal, 1, 9999, DEFAULTS.replyGoal);
  const verifiedGoal = clampInt(settings.verifiedGoal, 1, 1_000_000, DEFAULTS.verifiedGoal);
  const pollMinutes = clampInt(settings.pollMinutes, 1, 120, DEFAULTS.pollMinutes);
  await chrome.storage.local.set({ replyGoal, verifiedGoal, pollMinutes });
  await syncAlarm();
  const state = await chrome.storage.local.get(null);
  await renderToolbar(state);
  return state;
}

async function syncAlarm() {
  const { pollMinutes } = await chrome.storage.local.get("pollMinutes");
  const period = clampInt(pollMinutes, 1, 120, DEFAULTS.pollMinutes);
  await chrome.alarms.clear(ALARM);
  await chrome.alarms.create(ALARM, { periodInMinutes: period });
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

async function collect({ reason, tabId, force } = {}) {
  if (scrapeInFlight) {
    debug("refresh joined an in-progress scrape", { reason, tabId, force });
    return scrapeInFlight;
  }
  if (!force && Date.now() - lastScrapeAt < 15_000 && reason === "page") {
    debug("page scrape skipped by cooldown", { reason, lastScrapeAgeMs: Date.now() - lastScrapeAt });
    return chrome.storage.local.get(null);
  }
  debug("refresh started", { reason, tabId, force });
  scrapeInFlight = runCollect({ reason, tabId }).finally(() => {
    scrapeInFlight = null;
    lastScrapeAt = Date.now();
  });
  return scrapeInFlight;
}

async function runCollect({ reason, tabId }) {
  await chrome.storage.local.set({
    status: "loading",
    lastAttemptAt: Date.now(),
    lastAttemptReason: reason || "unknown",
  });
  await renderToolbar(await chrome.storage.local.get(null));

  let created = false;
  let tab = tabId ? await chrome.tabs.get(tabId).catch(() => null) : null;
  if (!tab) tab = await findAnalyticsTab();
  if (!tab) {
    tab = await chrome.tabs.create({ url: ANALYTICS_URL, active: false });
    created = true;
  }
  debug("analytics tab selected", {
    reason,
    tabId: tab.id,
    url: tab.url,
    status: tab.status,
    created,
  });

  try {
    const snapshot = await waitForSnapshot(tab.id);
    debug("analytics snapshot accepted", {
      tabId: tab.id,
      verifiedFollowers: snapshot.verifiedFollowers,
      repliesToday: snapshot.repliesToday,
      repliesReceived: snapshot.repliesReceived,
      repliesSource: snapshot.repliesSource,
      period: snapshot.period,
      captureCount: snapshot.captureCount,
      debug: snapshot.debug,
    });
    const state = await persistSnapshot(snapshot);
    await renderToolbar(state);
    return state;
  } catch (err) {
    console.warn("[X Goals] analytics refresh failed", { tabId: tab.id, error: String(err) });
    const state = await persistError(err);
    await renderToolbar(state);
    return state;
  } finally {
    if (created && tab?.id) {
      const fresh = await chrome.tabs.get(tab.id).catch(() => null);
      if (fresh && !fresh.active) {
        debug("closing temporary analytics tab", { tabId: tab.id });
        await chrome.tabs.remove(tab.id).catch(() => {});
      }
    }
  }
}

async function findAnalyticsTab() {
  const tabs = await chrome.tabs.query({ url: TAB_URLS });
  return tabs.find((t) => /account_analytics/i.test(t.url || "")) || null;
}

async function waitForSnapshot(tabId) {
  await waitComplete(tabId);
  let last = null;
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) throw new Error("Analytics tab closed");
    try {
      const [{ result } = {}] = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: scrapeAnalytics,
      });
      last = result;
      debug("analytics scrape attempt", {
        tabId,
        ok: result?.ok,
        loggedIn: result?.loggedIn,
        verifiedFollowers: result?.verifiedFollowers,
        repliesToday: result?.repliesToday,
        repliesSource: result?.repliesSource,
        debug: result?.debug,
      });
      if (result && result.loginWall) {
        throw new Error("Log in to X, then refresh.");
      }
      // Degrade gracefully: when X changes markup the verified-followers card
      // can read null and would block replies from ever refreshing. Accept a
      // snapshot on any logged-in page that produced at least one metric.
      const hasReplies = result?.repliesToday != null;
      const hasVerified = result?.verifiedFollowers != null;
      if (result && result.loggedIn && (hasReplies || hasVerified)) return result;
    } catch (err) {
      last = { error: String(err && err.message ? err.message : err) };
      console.warn("[X Goals] analytics scrape attempt threw", { tabId, error: last.error });
    }
    await sleep(2000);
  }
  if (last && last.verifiedFollowers != null) return last;
  throw new Error(
    last && last.error
      ? last.error
      : "Could not read analytics. Open x.com/i/account_analytics while logged in."
  );
}

async function waitComplete(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (tab.status === "complete") {
    await sleep(800);
    return;
  }
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error("Timed out loading analytics"));
    }, 30_000);
    function onUpdated(id, info) {
      if (id === tabId && info.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
  await sleep(800);
}

async function persistSnapshot(snapshot) {
  const existing = await chrome.storage.local.get(null);
  const today = dayKey(Date.now(), existing.timeZone || DEFAULTS.timeZone);
  const keepOutbound =
    snapshot.repliesToday == null &&
    existing.repliesDayKey === today &&
    existing.repliesSource &&
    existing.repliesSource !== "received-card";
  const repliesToday =
    snapshot.repliesToday != null ? snapshot.repliesToday : keepOutbound ? existing.repliesToday : null;
  const next = {
    status: "ok",
    lastError: null,
    lastSuccessAt: Date.now(),
    verifiedFollowers: snapshot.verifiedFollowers,
    repliesReceived: snapshot.repliesReceived,
    repliesToday,
    repliesSource: snapshot.repliesToday != null ? snapshot.repliesSource : keepOutbound ? existing.repliesSource : null,
    repliesDayKey: today,
    period: snapshot.period,
    lastUrl: snapshot.url,
    captureCount: snapshot.captureCount || 0,
  };
  debug("persisting analytics values", {
    today,
    incoming: {
      verifiedFollowers: snapshot.verifiedFollowers,
      repliesToday: snapshot.repliesToday,
      repliesReceived: snapshot.repliesReceived,
      repliesSource: snapshot.repliesSource,
    },
    previous: {
      verifiedFollowers: existing.verifiedFollowers,
      repliesToday: existing.repliesToday,
      repliesDayKey: existing.repliesDayKey,
      repliesSource: existing.repliesSource,
    },
    keepPreviousOutboundReplies: keepOutbound,
    saved: {
      verifiedFollowers: next.verifiedFollowers,
      repliesToday: next.repliesToday,
      repliesSource: next.repliesSource,
    },
  });
  await chrome.storage.local.set(next);
  return chrome.storage.local.get(null);
}

async function persistError(err) {
  await chrome.storage.local.set({
    status: "error",
    lastError: String(err && err.message ? err.message : err),
  });
  return chrome.storage.local.get(null);
}

async function renderToolbar(state) {
  const replies = state.repliesToday;
  const verified = state.verifiedFollowers;
  const replyGoal = state.replyGoal ?? DEFAULTS.replyGoal;
  const verifiedGoal = state.verifiedGoal ?? DEFAULTS.verifiedGoal;

  let badge = "";
  let color = "#536471";
  if (state.status === "loading") {
    badge = "...";
    color = "#536471";
  } else if (state.status === "error") {
    badge = "!";
    color = "#f4212e";
  } else if (replies != null) {
    badge = replies > 999 ? "999+" : String(Math.round(replies));
    color = replies >= replyGoal ? "#00ba7c" : "#1d9bf0";
  } else if (verified != null) {
    badge = verified > 999 ? `${Math.round(verified / 100) / 10}k` : String(Math.round(verified));
    color = verified >= verifiedGoal ? "#00ba7c" : "#1d9bf0";
  }

  await chrome.action.setBadgeText({ text: badge });
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setTitle({
    title: titleFor(state),
  });
  try {
    await chrome.action.setIcon({ imageData: drawIcon(state) });
  } catch {
    /* keep packaged icons */
  }
}

function titleFor(state) {
  const r = state.repliesToday;
  const v = state.verifiedFollowers;
  const rg = state.replyGoal ?? DEFAULTS.replyGoal;
  const vg = state.verifiedGoal ?? DEFAULTS.verifiedGoal;
  const replies = r == null ? "replies —" : `replies ${r}/${rg}`;
  const verified = v == null ? "verified —" : `verified ${v}/${vg}`;
  return `X Goals · ${replies} · ${verified}`;
}

function drawIcon(state) {
  const size = 128;
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d");
  const replies = state.repliesToday;
  const verified = state.verifiedFollowers;
  const replyGoal = state.replyGoal ?? DEFAULTS.replyGoal;
  const verifiedGoal = state.verifiedGoal ?? DEFAULTS.verifiedGoal;
  const repliesDone = replies != null && replies >= replyGoal;
  const verifiedDone = verified != null && verified >= verifiedGoal;

  ctx.fillStyle = "#0f1419";
  roundRect(ctx, 0, 0, size, size, 28);
  ctx.fill();

  ctx.fillStyle = repliesDone ? "#00ba7c" : "#1d9bf0";
  ctx.font = "bold 44px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(replies == null ? "–" : String(Math.round(replies)), 64, 54);

  ctx.fillStyle = "#8b98a5";
  ctx.font = "600 18px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(`/${replyGoal} replies`, 64, 76);

  ctx.fillStyle = verifiedDone ? "#00ba7c" : "#e7e9ea";
  ctx.font = "bold 32px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(verified == null ? "– vf" : `${Math.round(verified)} vf`, 64, 114);

  return ctx.getImageData(0, 0, size, size);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
