/** Injected into the X analytics page (MAIN world). Must stay self-contained. */
export function scrapeAnalytics() {
  function parseCompact(text) {
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

  function parseFlowEl(el) {
    const raw = el.getAttribute("data");
    if (raw) {
      try {
        const json = JSON.parse(raw);
        if (typeof json.value === "number" && Number.isFinite(json.value)) return json.value;
        const compact = parseCompact(json.valueAsString);
        if (compact != null) return compact;
      } catch {
        /* text fallback */
      }
    }
    return parseCompact(el.textContent);
  }

  function cardValue(label) {
    const hits = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (walker.currentNode.textContent.trim() === label) hits.push(walker.currentNode);
    }
    for (const node of hits) {
      let el = node.parentElement;
      for (let i = 0; i < 10 && el; i += 1, el = el.parentElement) {
        const flow = el.querySelector("number-flow-react");
        if (flow) return parseFlowEl(flow);
      }
    }
    return cardValueFuzzy(label);
  }

  function cardValueFuzzy(label) {
    const words = label.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return null;
    const flows = document.querySelectorAll("number-flow-react");
    let best = null; // { flow, textLen }
    for (const flow of flows) {
      let el = flow.parentElement;
      for (let i = 0; i < 12 && el; i += 1, el = el.parentElement) {
        const text = (el.innerText || el.textContent || "").toLowerCase();
        if (words.every((w) => text.includes(w))) {
          const textLen = text.length;
          if (!best || textLen < best.textLen) best = { flow, textLen };
          break;
        }
      }
    }
    return best ? parseFlowEl(best.flow) : null;
  }

  function isOutboundRow(row) {
    if (!row || typeof row !== "object") return false;
    const keys = Object.keys(row);
    return keys.some((k) => /^posts$/i.test(k)) && keys.some((k) => /^replies$/i.test(k));
  }

  function repliesFromRow(row) {
    if (!isOutboundRow(row)) return null;
    for (const key of Object.keys(row)) {
      if (/^replies$/i.test(key) && typeof row[key] === "number") return row[key];
    }
    return null;
  }

  function postsFromRow(row) {
    if (!isOutboundRow(row)) return null;
    for (const key of Object.keys(row)) {
      if (/^posts$/i.test(key) && typeof row[key] === "number") return row[key];
    }
    return null;
  }

  function dayKey(now, timeZone) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  }

  function toDayKey(raw, timeZone) {
    if (raw == null || raw === "") return null;
    if (raw instanceof Date && !Number.isNaN(raw.getTime())) return dayKey(raw.getTime(), timeZone);
    if (typeof raw === "number" && Number.isFinite(raw)) return dayKey(raw, timeZone);
    const s = String(raw).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const parsed = Date.parse(s);
    if (!Number.isNaN(parsed)) return dayKey(parsed, timeZone);
    return null;
  }

  function pickTodayRow(data) {
    if (!Array.isArray(data) || !data.length) return { row: null, decision: "no-series", candidates: [] };
    const rows = data.filter(isOutboundRow);
    if (!rows.length) return { row: null, decision: "no-outbound-rows", candidates: [] };
    const tz = "America/Denver";    const today = dayKey(Date.now(), tz);
    const candidates = rows.map((row, index) => {
      const raw = row.date ?? row.day ?? row.x ?? row.name ?? row.label ?? row.timestamp;
      return {
        index,
        rawDate: raw == null ? null : String(raw),
        dayKey: toDayKey(raw, tz),
        posts: row.posts,
        replies: repliesFromRow(row),
      };
    });
    for (let index = 0; index < rows.length; index += 1) {
      if (candidates[index].dayKey === today) {
        return { row: rows[index], decision: "matched-today", candidates };
      }
    }
    return { row: rows[rows.length - 1], decision: "fell-back-to-last-row", candidates };
  }

  function seriesHistoryFrom(data) {
    if (!Array.isArray(data) || !data.length) return [];
    const tz = "America/Denver";
    const byDay = {};
    for (const row of data) {
      if (!isOutboundRow(row)) continue;
      const raw = row.date ?? row.day ?? row.x ?? row.name ?? row.label ?? row.timestamp;
      const day = toDayKey(raw, tz);
      if (!day) continue;
      const replies = repliesFromRow(row);
      const posts = postsFromRow(row);
      if (replies == null && posts == null) continue;
      byDay[day] = { day, replies: replies ?? null, posts: posts ?? null };
    }
    return Object.values(byDay)
      .sort((a, b) => (a.day < b.day ? -1 : 1))
      .slice(-90);
  }

  function selectedPeriod() {
    const wanted = ["7D", "2W", "4W", "3M", "1Y"];
    const buttons = Array.from(document.querySelectorAll("button"));
    for (const p of wanted) {
      const b = buttons.find((btn) => btn.textContent.trim() === p);
      if (!b) continue;
      if (b.getAttribute("aria-pressed") === "true" || b.getAttribute("data-state") === "on") {
        return p;
      }
    }
    return null;
  }

  function postsRepliesChart() {
    return (
      document.querySelector("[data-chart='chart-re']") ||
      Array.from(document.querySelectorAll("[data-chart]")).find((el) =>
        /Posts/i.test(el.textContent) && /Replies/i.test(el.textContent)
      ) ||
      Array.from(document.querySelectorAll(".recharts-responsive-container")).find((el) => {
        const root = el.closest("[class]") || el.parentElement;
        const block = root && root.parentElement;
        return block && /Posts/i.test(block.textContent) && /Replies/i.test(block.textContent);
      })
    );
  }

  function seriesFromReact(root) {
    if (!root) return null;
    const found = [];
    const seen = new Set();
    const visit = (el, depth) => {
      if (!el || depth > 45) return;
      for (const key of Object.keys(el)) {
        if (!key.startsWith("__reactFiber") && !key.startsWith("__reactInternalInstance")) continue;
        let fiber = el[key];
        for (let i = 0; i < 55 && fiber; i += 1, fiber = fiber.return) {
          if (seen.has(fiber)) continue;
          seen.add(fiber);
          const props = fiber.memoizedProps;
          if (!props) continue;
          for (const data of [props.data, props.chartData]) {
            if (Array.isArray(data) && data.some(isOutboundRow)) found.push(data);
          }
        }
      }
      const children = el.children || [];
      for (let i = 0; i < children.length; i += 1) visit(children[i], depth + 1);
    };
    visit(root, 0);
    return found[0] || null;
  }

  function seriesFromCaptures() {
    const caps = window.__XCHROME_CAPTURES || [];
    let verified = null;
    let series = null;
    const walk = (obj, depth) => {
      if (!obj || depth > 16) return;
      if (Array.isArray(obj)) {
        if (obj.some(isOutboundRow)) series = series || obj;
        for (let i = 0; i < obj.length; i += 1) walk(obj[i], depth + 1);
        return;
      }
      if (typeof obj !== "object") return;
      for (const [key, value] of Object.entries(obj)) {
        if (
          verified == null &&
          /verified_follower_count|verifiedFollowers|verified_followers|active_verified_followers/i.test(key) &&
          (typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value.trim())))
        ) {
          verified = Number(value);
        }
        walk(value, depth + 1);
      }
    };
    for (const cap of caps) walk(cap.data, 0);
    return { verified, series };
  }

  // accountOverviewDailyQuery payload: replies YOU posted today = the
  // ReplyCreate counts inside current_time_series (engagement_type "Reply"
  // is inbound replies received, never counted).
  function dailyFromCaptures() {
    const caps = window.__XCHROME_CAPTURES || [];
    const cap = caps
      .slice()
      .reverse()
      .find((c) => /accountOverviewDailyQuery/i.test(String(c.url || "")) && c.data);
    if (!cap) return null;
    const viewer = cap.data?.data?.viewer_v2?.user_results?.result;
    if (!viewer) return null;
    let repliesPosted = null;
    // The overview serves the previous day(s) in current_time_series and the
    // partial current day in hourly_backfill. Today's count = ReplyCreate
    // rows at the latest timestamp across BOTH arrays.
    const entries = []
      .concat(Array.isArray(viewer.current_time_series) ? viewer.current_time_series : [])
      .concat(Array.isArray(viewer.hourly_backfill) ? viewer.hourly_backfill : []);
    if (entries.length) {
      const stamps = entries
        .map((e) => (e && Number.isFinite(Number(e.timestamp)) ? Number(e.timestamp) : null))
        .filter((t) => t != null);
      const todayStamp = stamps.length ? Math.max(...stamps) : null;
      // The same day can appear in both arrays (and multiple entries per
      // day); the dashboard shows one number, so take the max per timestamp
      // rather than summing duplicates.
      let max = 0;
      let seen = false;
      for (const entry of entries) {
        if (!entry || !/^ReplyCreate$/i.test(String(entry.engagement_type || ""))) continue;
        if (todayStamp != null && Number(entry.timestamp) !== todayStamp) continue;
        const c = Number(entry.count);
        if (Number.isFinite(c)) {
          max = Math.max(max, c);
          seen = true;
        }
      }
      if (seen) repliesPosted = max;
    }
    // Posts to your timeline = original posts you authored today.
    // TweetCreate (+ QuoteCreate) rows at the latest timestamp across BOTH
    // arrays. Missing type at the latest stamp means 0, not unknown.
    let postsPosted = null;
    if (entries.length) {
      const stamps = entries
        .map((e) => (e && Number.isFinite(Number(e.timestamp)) ? Number(e.timestamp) : null))
        .filter((t) => t != null);
      const todayStamp = stamps.length ? Math.max(...stamps) : null;
      if (todayStamp != null) {
        let maxTweet = 0;
        let maxQuote = 0;
        let seenTweet = false;
        let seenQuote = false;
        for (const entry of entries) {
          if (!entry || Number(entry.timestamp) !== todayStamp) continue;
          const c = Number(entry.count);
          if (!Number.isFinite(c)) continue;
          if (/^TweetCreate$/i.test(String(entry.engagement_type || ""))) {
            maxTweet = Math.max(maxTweet, c);
            seenTweet = true;
          } else if (/^QuoteCreate$/i.test(String(entry.engagement_type || ""))) {
            maxQuote = Math.max(maxQuote, c);
            seenQuote = true;
          }
        }
        // Only report when the latest stamp actually has timeline-post rows
        // or when sibling ReplyCreate rows prove the stamp is "today".
        // (Avoid inventing 0s from unrelated payloads.)
        if (seenTweet || seenQuote || repliesPosted != null) {
          postsPosted = (seenTweet ? maxTweet : 0) + (seenQuote ? maxQuote : 0);
        }
      }
    }
    let verified = null;
    const raw = viewer.verified_follower_count;
    if (raw != null && /^\d+$/.test(String(raw).trim())) verified = Number(String(raw).trim());
    // The query window is anchored to UTC midnight; the selected day is the
    // UTC date of current_from_iso (matches what the dashboard shows).
    let day = null;
    {
      const us = String(cap.url || "");
      const ki = us.indexOf("current_from_iso");
      if (ki >= 0) {
        const m = us.slice(ki, ki + 80).match(/(\d{4}-\d{2}-\d{2})/);
        if (m) day = m[1];
      }
    }
    return { repliesPosted, postsPosted, verified, day };
  }

  // Verified Home Timeline impressions estimate for the rewards threshold
  // (500K / 90 days). Uses the single captured overview payload with the
  // widest query window: the analytics page fires one query per selected
  // period (7D / 28D / 3M …), so summing across captures would count the
  // same days several times over. Within that payload, Displayed rows
  // attributed to verified viewers are summed per timestamp bucket; a bucket
  // appearing in both current_time_series and hourly_backfill counts once
  // (max). previous_totals is the prior comparison period — never summed.
  // NOTE: Displayed rows don't say which surface produced the impression
  // (Home Timeline vs profile/etc.) and don't exclude replies — X computes
  // the official qualified number server-side. This is a progress estimate.
  function verifiedImpressionsFromCaptures() {
    const caps = window.__XCHROME_CAPTURES || [];
    const perCapture = [];
    // URLs look like ...%22from_time%22%3A%222026-06-05T00%3A00... — find
    // the key, then the first YYYY-MM-DD shortly after it.
    const grab = (s, keys) => {
      for (const key of keys) {
        let from = 0;
        while (true) {
          const i = s.indexOf(key, from);
          if (i < 0) break;
          const m = s.slice(i, i + 60).match(/(\d{4}-\d{2}-\d{2})/);
          if (m) {
            const t = Date.parse(`${m[1]}T00:00:00Z`);
            if (!Number.isNaN(t)) return t;
          }
          from = i + key.length;
        }
      }
      return null;
    };
    const eatInto = (buckets, entry) => {
      if (!entry || typeof entry !== "object") return;
      if (!/^Displayed$/i.test(String(entry.engagement_type || ""))) return;
      const v = entry.is_engaging_user_verified;
      const verifiedViewer = v === true || String(v).toLowerCase() === "true";
      if (!verifiedViewer) return;
      const c = Number(entry.count);
      if (!Number.isFinite(c) || c < 0) return;
      const ts = Number(entry.timestamp);
      const key = `${Number.isFinite(ts) ? ts : "na"}|verified`;
      const prev = buckets.get(key);
      if (prev == null || c > prev) buckets.set(key, c);
    };
    const walk = (buckets, obj, depth) => {
      if (!obj || depth > 16) return;
      if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i += 1) {
          const item = obj[i];
          if (item && typeof item === "object" && "count" in item && "engagement_type" in item) eatInto(buckets, item);
          else walk(buckets, item, depth + 1);
        }
        return;
      }
      if (typeof obj !== "object") return;
      for (const value of Object.values(obj)) walk(buckets, value, depth + 1);
    };
    for (const cap of caps) {
      if (!cap || !cap.data) continue;
      const viewer = cap.data?.data?.viewer_v2?.user_results?.result;
      const buckets = new Map();
      if (viewer) {
        walk(buckets, viewer.current_time_series, 1);
        walk(buckets, viewer.hourly_backfill, 1);
      } else {
        walk(buckets, cap.data, 1);
      }
      if (!buckets.size) continue;
      let total = 0;
      for (const c of buckets.values()) total += c;
      const s = String(cap.url || "");
      const from = grab(s, ["from_time", "from_iso", "current_from_iso"]);
      const to = grab(s, ["to_time", "to_iso", "current_to_iso"]);
      const windowDays =
        from != null && to != null && to > from ? Math.round((to - from) / 86_400_000) : null;
      perCapture.push({ total: Math.round(total), windowDays, buckets: buckets.size });
    }
    if (!perCapture.length) return null;
    const withWindow = perCapture.filter((c) => c.windowDays != null);
    const best = withWindow.length
      ? withWindow.slice().sort((a, b) => b.windowDays - a.windowDays || b.total - a.total)[0]
      : perCapture[perCapture.length - 1];
    return {
      total: best.total,
      windowDays: best.windowDays,
      payloads: perCapture.length,
      buckets: best.buckets,
      perCapture: perCapture.length > 1 ? perCapture : undefined,
    };
  }

  function repliesFromTooltip(scope) {
    const nodes = (scope || document).querySelectorAll(
      ".recharts-tooltip-wrapper, .recharts-default-tooltip, [role='tooltip']"
    );
    for (const node of nodes) {
      const style = window.getComputedStyle(node);
      if (style && (style.visibility === "hidden" || style.opacity === "0")) continue;
      const text = node.innerText || "";
      if (!/Posts/i.test(text) || !/Replies/i.test(text)) continue;
      const match = text.match(/Replies[^\d]*(\d+(?:\.\d+)?)/i);
      if (match) return Number(match[1]);
    }
    return null;
  }

  function replyBars(chart) {
    if (!chart) return [];
    return Array.from(chart.querySelectorAll("path.recharts-rectangle")).filter((path) => {
      const fill = path.getAttribute("fill") || "";
      return /color-Replies/i.test(fill);
    });
  }

  function repliesFromBars(chart) {
    const bars = replyBars(chart);
    if (!bars.length) return null;
    let best = null;
    let bestX = -Infinity;
    for (const bar of bars) {
      const x = parseFloat(bar.getAttribute("x"));
      if (!Number.isFinite(x) || x < bestX) continue;
      bestX = x;
      best = bar;
    }
    if (!best) return null;
    const y = parseFloat(best.getAttribute("y"));
    const ticks = [];
    chart.querySelectorAll(".recharts-yAxis .recharts-cartesian-axis-tick, .yAxis .recharts-cartesian-axis-tick").forEach((tick) => {
      const label = parseCompact(tick.textContent);
      const text = tick.querySelector("text");
      const ty = text ? parseFloat(text.getAttribute("y")) : NaN;
      if (label != null && Number.isFinite(ty)) ticks.push({ val: label, y: ty });
    });
    if (ticks.length < 2 || !Number.isFinite(y)) return null;
    ticks.sort((a, b) => a.y - b.y);
    const top = ticks[0];
    const bottom = ticks[ticks.length - 1];
    if (top.y === bottom.y) return Math.round(top.val);
    const value = top.val + ((y - top.y) * (bottom.val - top.val)) / (bottom.y - top.y);
    if (!Number.isFinite(value) || value < 0) return null;
    return Math.round(value);
  }

  function repliesFromHover(chart) {
    const bars = replyBars(chart);
    if (!bars.length) return null;
    let best = bars[0];
    let bestX = parseFloat(best.getAttribute("x")) || 0;
    for (const bar of bars) {
      const x = parseFloat(bar.getAttribute("x"));
      if (Number.isFinite(x) && x > bestX) {
        bestX = x;
        best = bar;
      }
    }
    const box = best.getBoundingClientRect();
    const opts = {
      bubbles: true,
      cancelable: true,
      clientX: box.left + Math.max(2, box.width / 2),
      clientY: box.top + Math.max(2, box.height / 4),
      view: window,
    };
    best.dispatchEvent(new MouseEvent("mouseover", opts));
    best.dispatchEvent(new MouseEvent("mousemove", opts));
    return repliesFromTooltip(chart) ?? repliesFromTooltip(document);
  }

  const href = location.href;
  const loginWall =
    /\/i\/flow\/login|\/login\b/i.test(href) || !!document.querySelector('[data-testid="loginButton"]');
  const overviewVisible =
    (document.body && document.body.innerText.includes("Verified followers")) ||
    (document.body && document.body.innerText.includes("Account overview"));
  const loggedIn =
    !loginWall &&
    (!!document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]') || overviewVisible);

  const captured = seriesFromCaptures();
  const daily = dailyFromCaptures();
  const verifiedImpressions = verifiedImpressionsFromCaptures();
  const chart = postsRepliesChart();
  const reactSeries = seriesFromReact(chart || document.body);
  const series = reactSeries || captured.series;
  const picked = pickTodayRow(series);
  const row = picked.row;
  const seriesHistory = seriesHistoryFrom(series);
  const verifiedFollowers =
    (daily && daily.verified != null ? daily.verified : null) ??
    cardValue("Verified followers") ??
    captured.verified;
  const repliesReceived = cardValue("Replies");

  let repliesToday = daily && daily.repliesPosted != null ? daily.repliesPosted : null;
  let repliesSource = repliesToday != null ? "daily-query" : null;
  if (repliesToday == null) {
    repliesToday = repliesFromRow(row);
    repliesSource = repliesToday != null ? "chart-data" : null;
  }
  let postsToday = daily && daily.postsPosted != null ? daily.postsPosted : null;
  let postsSource = postsToday != null ? "daily-query" : null;
  if (postsToday == null) {
    postsToday = postsFromRow(row);
    postsSource = postsToday != null ? "chart-data" : null;
  }
  if (repliesToday == null) {
    const hovered = repliesFromHover(chart);
    if (hovered != null) {
      repliesToday = hovered;
      repliesSource = "tooltip";
    }
  }
  if (repliesToday == null) {
    const fromBars = repliesFromBars(chart);
    if (fromBars != null) {
      repliesToday = fromBars;
      repliesSource = "bars";
    }
  }

  const debug = {
    scrapedAt: new Date().toISOString(),
    todayDenver: dayKey(Date.now(), "America/Denver"),
    seriesSource: series ? (reactSeries ? "react" : "network-capture") : "none",
    chartFound: Boolean(chart),
    replyBarCount: replyBars(chart).length,
    rowDecision: picked.decision,
    rowCandidates: picked.candidates,
    selectedRow: row
      ? {
          rawDate: String(row.date ?? row.day ?? row.x ?? row.name ?? row.label ?? row.timestamp ?? ""),
          replies: repliesFromRow(row),
          posts: row.posts,
        }
      : null,
    cardValues: { verifiedFollowers, repliesReceived },
    dailyQuery: daily,
    dailyQuery: daily,
    verifiedImpressions,
    seriesHistoryDays: seriesHistory.length,
    captureCount: (window.__XCHROME_CAPTURES || []).length,
  };
  console.info("[X Goals] analytics scrape details", debug);

  return {
    ok: Boolean(loggedIn && verifiedFollowers != null),
    loggedIn,
    loginWall,
    url: href,
    title: document.title,
    verifiedFollowers,
    repliesReceived,
    repliesToday,
    repliesSource,
    postsToday,
    postsSource,
    verifiedImpressions: verifiedImpressions ? verifiedImpressions.total : null,
    verifiedImpressionsWindowDays: verifiedImpressions ? verifiedImpressions.windowDays : null,
    verifiedImpressionsSource: verifiedImpressions ? "captures" : null,
    seriesHistory,
    period: selectedPeriod(),
    captureCount: (window.__XCHROME_CAPTURES || []).length,
    debug,
  };
}

/** Scrapes the official Original Content Rewards page. Must stay self-contained. */
export function scrapeRewards() {
  function parseCompact(text) {
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

  function numberAfter(label) {
    const body = document.body;
    const text = body ? body.innerText || body.textContent || "" : "";
    const i = text.indexOf(label);
    if (i < 0) return null;
    const m = text.slice(i + label.length, i + label.length + 120).match(/([\d,.]+(?:\.\d+)?[KMB]?)/i);
    return m ? parseCompact(m[1]) : null;
  }

  const href = location.href;
  const loginWall =
    /\/i\/flow\/login|\/login\b/i.test(href) || !!document.querySelector('[data-testid="loginButton"]');
  const text = document.body ? document.body.innerText || "" : "";
  const onRewardsPage = /Original Content Rewards/i.test(text);
  const loggedIn =
    !loginWall &&
    (!!document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]') || onRewardsPage);
  const rewardsVerifiedFollowers = numberAfter("Have at least 500 Verified followers");
  const rewardsImpressions90d = numberAfter(
    "Have at least 500K Verified Home Timeline impressions in the last 90 days"
  );
  return {
    ok: Boolean(loggedIn && !loginWall && rewardsImpressions90d != null),
    loggedIn,
    loginWall,
    url: href,
    title: document.title,
    rewardsVerifiedFollowers,
    rewardsImpressions90d,
  };
}
