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
    const tz = "America/Denver";
    const today = dayKey(Date.now(), tz);
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
    let verified = null;
    const raw = viewer.verified_follower_count;
    if (raw != null && /^\d+$/.test(String(raw).trim())) verified = Number(String(raw).trim());
    // The query window is anchored to UTC midnight; the selected day is the
    // UTC date of current_from_iso (matches what the dashboard shows).
    let day = null;
    const fromIso = String(cap.url || "").match(/current_from_iso.%22(\\d{4}-\\d{2}-\\d{2})/);
    if (fromIso) day = fromIso[1];
    return { repliesPosted, verified, day };
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
  const chart = postsRepliesChart();
  const reactSeries = seriesFromReact(chart || document.body);
  const series = reactSeries || captured.series;
  const picked = pickTodayRow(series);
  const row = picked.row;
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
    period: selectedPeriod(),
    captureCount: (window.__XCHROME_CAPTURES || []).length,
    debug,
  };
}
