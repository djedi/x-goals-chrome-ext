export const DEFAULTS = {
  replyGoal: 60,
  postGoal: 3,
  verifiedGoal: 500,
  pollMinutes: 5,
  timeZone: "America/Denver",
};

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
