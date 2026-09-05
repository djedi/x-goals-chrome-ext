export const DEFAULTS = {
  replyGoal: 60,
  postGoal: 3,
  verifiedGoal: 500,
  pollMinutes: 5,
  timeZone: "America/Denver",
};

/** Fixed X Original Content Rewards entry threshold (not user-settable). */
export const VERIFIED_IMPRESSION_GOAL = 500_000;

export function dayKey(now = Date.now(), timeZone = DEFAULTS.timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function parseCompactNumber(text) {
  if (text == null) return null;
  const s = String(text).trim().replace(/,/g, "").replace(/^\+/, "");
  if (!s || s === "—" || s === "-") return null;
  const m = s.match(/^(-?\d+(?:\.\d+)?)([KMB])?%?$/i);
  if (!m) {
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(m[1]);
  const mul = { K: 1e3, M: 1e6, B: 1e9 }[m[2]?.toUpperCase()] || 1;
  return n * mul;
}

export function parseNumberFlowPayload(raw) {
  if (raw == null || raw === "") return null;
  const json = typeof raw === "string" ? JSON.parse(raw.replace(/&quot;/g, '"')) : raw;
  if (typeof json.value === "number" && Number.isFinite(json.value)) return json.value;
  return parseCompactNumber(json.valueAsString);
}

export function extractCardValueFromInnerText(text, label) {
  if (!text || !label) return null;
  const normalized = String(text).replace(/\u00a0/g, " ");
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escaped}\\s*[:\\n]\\s*([\\d,.]+(?:\\.\\d+)?[KMB]?)`, "i");
  const match = normalized.match(re);
  return match ? parseCompactNumber(match[1]) : null;
}

export function extractCardValueFromHtml(html, label) {
  let searchFrom = 0;
  while (searchFrom < html.length) {
    const idx = html.indexOf(label, searchFrom);
    if (idx < 0) return null;
    const slice = html.slice(idx, idx + 4500);
    const dataMatch = slice.match(/<number-flow-react\b[^>]*\sdata="([^"]+)"/i);
    if (dataMatch) return parseNumberFlowPayload(dataMatch[1]);
    searchFrom = idx + label.length;
  }
  return null;
}

export function parseAnalyticsHtml(html) {
  return {
    verifiedFollowers: extractCardValueFromHtml(html, "Verified followers"),
    repliesReceived: extractCardValueFromHtml(html, "Replies"),
    likes: extractCardValueFromHtml(html, "Likes"),
    impressions: extractCardValueFromHtml(html, "Impressions"),
    engagements: extractCardValueFromHtml(html, "Engagements"),
    profileVisits: extractCardValueFromHtml(html, "Profile visits"),
  };
}

/** Outbound content mix (Posts + Replies you authored). Not inbound engagement. */
export function isOutboundContentRow(row) {
  if (!row || typeof row !== "object") return false;
  const keys = Object.keys(row);
  const hasPosts = keys.some((k) => /^posts$/i.test(k));
  const hasReplies = keys.some((k) => /^replies$/i.test(k));
  return hasPosts && hasReplies;
}

export function outboundRepliesFromRow(row) {
  if (!isOutboundContentRow(row)) return null;
  for (const key of Object.keys(row)) {
    if (/^replies$/i.test(key) && typeof row[key] === "number") return row[key];
  }
  return null;
}

export function outboundPostsFromRow(row) {
  if (!isOutboundContentRow(row)) return null;
  for (const key of Object.keys(row)) {
    if (/^posts$/i.test(key) && typeof row[key] === "number") return row[key];
  }
  return null;
}

export function toDayKey(raw, timeZone = DEFAULTS.timeZone) {
  if (raw == null || raw === "") return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return dayKey(raw.getTime(), timeZone);
  if (typeof raw === "number" && Number.isFinite(raw)) return dayKey(raw, timeZone);
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const parsed = Date.parse(s);
  if (!Number.isNaN(parsed)) return dayKey(parsed, timeZone);
  return null;
}

export function pickTodayOutboundRow(data, now = Date.now(), timeZone = DEFAULTS.timeZone) {
  if (!Array.isArray(data) || data.length === 0) return null;
  const rows = data.filter(isOutboundContentRow);
  if (!rows.length) return null;
  const today = dayKey(now, timeZone);
  for (const row of rows) {
    const raw = row.date ?? row.day ?? row.x ?? row.name ?? row.label ?? row.timestamp;
    if (toDayKey(raw, timeZone) === today) return row;
  }
  return rows[rows.length - 1];
}

/** Official Original Content Rewards eligibility page (plain-text labels). */
export function extractRewardsProgress(text) {
  if (!text) return { verifiedFollowers: null, impressions90d: null };
  const grab = (label) => {
    const hay = String(text);
    const i = hay.indexOf(label);
    if (i < 0) return null;
    const m = hay.slice(i + label.length, i + label.length + 120).match(/([\d,.]+(?:\.\d+)?[KMB]?)/i);
    return m ? parseCompactNumber(m[1]) : null;
  };
  return {
    verifiedFollowers: grab("Have at least 500 Verified followers"),
    impressions90d: grab("Have at least 500K Verified Home Timeline impressions in the last 90 days"),
  };
}

export const HISTORY_LIMIT_DAYS = 90;

export function sortedDayKeys(history) {
  if (!history || typeof history !== "object") return [];
  return Object.keys(history)
    .filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k))
    .sort();
}

export function pruneHistory(history, limit = HISTORY_LIMIT_DAYS) {
  const keys = sortedDayKeys(history);
  if (keys.length <= limit) return { ...(history ?? {}) };
  const keep = new Set(keys.slice(keys.length - limit));
  const out = {};
  for (const k of keep) out[k] = history[k];
  return out;
}

export function mergeDay(history, day, patch, options = {}) {
  const { overwrite = false } = options;
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return { ...(history ?? {}) };
  if (!patch || typeof patch !== "object") return { ...(history ?? {}) };
  const out = { ...(history ?? {}) };
  const prev = { ...(out[day] ?? {}) };
  let touched = false;
  for (const key of ["replies", "posts", "verified", "impressions", "rewardsImpressions", "rewardsVerified"]) {
    const v = patch[key];
    if (v == null) continue;
    if (!overwrite && prev[key] != null) continue;
    prev[key] = v;
    touched = true;
  }
  if (touched || out[day]) out[day] = prev;
  if (out[day] && Object.keys(out[day]).length === 0) delete out[day];
  return out;
}

export function mergeSeriesHistory(history, daysObj, options = {}) {
  let out = { ...(history ?? {}) };
  if (!daysObj || typeof daysObj !== "object") return out;
  for (const [day, entry] of Object.entries(daysObj)) {
    out = mergeDay(out, day, entry, options);
  }
  return pruneHistory(out);
}

export function seriesToHistory(series, timeZone = DEFAULTS.timeZone) {
  const out = {};
  if (!Array.isArray(series)) return out;
  for (const row of series) {
    if (!isOutboundContentRow(row)) continue;
    const raw = row.date ?? row.day ?? row.x ?? row.name ?? row.label ?? row.timestamp;
    const day = toDayKey(raw, timeZone);
    if (!day) continue;
    const replies = outboundRepliesFromRow(row);
    const posts = outboundPostsFromRow(row);
    if (replies == null && posts == null) continue;
    out[day] = { ...(out[day] ?? {}) };
    if (replies != null) out[day].replies = replies;
    if (posts != null) out[day].posts = posts;
  }
  return out;
}

export function recentDayKeys(n, now = Date.now(), timeZone = DEFAULTS.timeZone) {
  const out = [];
  const seen = new Set();
  let t = now;
  const stop = now - (n + 3) * 86_400_000;
  while (out.length < n && t > stop) {
    const k = dayKey(t, timeZone);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
    t -= 3_600_000;
  }
  return out.slice(0, n).reverse();
}

export function buildTrendSeries(history, n = 30, now = Date.now(), timeZone = DEFAULTS.timeZone) {
  const h = history ?? {};
  return recentDayKeys(n, now, timeZone).map((day) => {
    const e = h[day] ?? {};
    return {
      day,
      replies: e.replies ?? null,
      posts: e.posts ?? null,
      verified: e.verified ?? null,
      impressions: e.impressions ?? null,
      rewardsImpressions: e.rewardsImpressions ?? null,
      rewardsVerified: e.rewardsVerified ?? null,
    };
  });
}

export function summarizeTrend(series) {
  let totalReplies = 0;
  let totalPosts = 0;
  let repliesDays = 0;
  let postsDays = 0;
  const verifiedPts = [];
  for (const d of series ?? []) {
    if (d.replies != null) {
      totalReplies += d.replies;
      repliesDays += 1;
    }
    if (d.posts != null) {
      totalPosts += d.posts;
      postsDays += 1;
    }
    if (d.verified != null) verifiedPts.push(d.verified);
  }
  const verifiedStart = verifiedPts.length ? verifiedPts[0] : null;
  const verifiedEnd = verifiedPts.length ? verifiedPts[verifiedPts.length - 1] : null;
  return {
    totalReplies,
    totalPosts,
    repliesDays,
    postsDays,
    verifiedStart,
    verifiedEnd,
    verifiedDelta: verifiedStart != null && verifiedEnd != null ? verifiedEnd - verifiedStart : null,
  };
}
