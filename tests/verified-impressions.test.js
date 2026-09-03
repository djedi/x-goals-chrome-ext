import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

// Reuse the scrape.js-in-a-shim harness: runs the real scrapeAnalytics
// against fake DOM + synthetic network captures.
const src = readFileSync(new URL("../scrape.js", import.meta.url), "utf8");
const cut = src.indexOf("export function scrapeRewards()");
const analyticsSrc = cut >= 0 ? src.slice(0, cut) : src;
const inner = analyticsSrc
  .replace(/^\/\*\*[\s\S]*?\*\//, "")
  .replace("export function scrapeAnalytics() {", "function scrapeAnalytics() {");

function runScrape(document, window, location) {
  const fn = new Function(
    "document",
    "window",
    "location",
    "NodeFilter",
    "MouseEvent",
    "console",
    `${inner}\nreturn scrapeAnalytics();`
  );
  return fn(
    document,
    window,
    location,
    { SHOW_TEXT: 4 },
    class MouseEvent {
      constructor(type, opts) {
        this.type = type;
        Object.assign(this, opts || {});
      }
    },
    { info: () => {} }
  );
}

const T1 = 1788307200000;
const T2 = 1788393600000;

function doc() {
  const body = {
    innerText: "Account overview",
    textContent: "Account overview",
    querySelectorAll: () => [],
    querySelector: () => null,
    parentElement: null,
  };
  return {
    body,
    querySelectorAll: () => [],
    querySelector: () => null,
    createTreeWalker: () => ({ nextNode: () => false }),
  };
}

test("sums verified Displayed once per timestamp, ignores the rest", () => {
  const window = {
    __XCHROME_CAPTURES: [
      {
        url:
          "https://x.com/i/api/graphql/abc/AccountOverviewQuery?variables=%7B%22from_time%22%3A%222026-06-05T00%3A00%3A00.000Z%22%2C%22to_time%22%3A%222026-09-03T00%3A00%3A00.000Z%22",
        data: {
          data: {
            viewer_v2: {
              user_results: {
                result: {
                  verified_follower_count: "291",
                  current_time_series: [
                    { count: 3540, engagement_type: "Displayed", is_engaging_user_verified: "true", timestamp: T1 },
                    { count: 8338, engagement_type: "Displayed", is_engaging_user_verified: "false", timestamp: T1 },
                    { count: 100, engagement_type: "Displayed", is_engaging_user_verified: "true", timestamp: T2 },
                    { count: 32, engagement_type: "Reply", is_engaging_user_verified: "true", timestamp: T1 },
                    { count: 260, engagement_type: "HomeLinger", is_engaging_user_verified: "true", timestamp: T1 },
                  ],
                  hourly_backfill: [
                    { count: 3540, engagement_type: "Displayed", is_engaging_user_verified: "true", timestamp: T1 },
                    { count: 50, engagement_type: "Displayed", is_engaging_user_verified: "true", timestamp: T2 },
                  ],
                },
              },
            },
          },
        },
        t: Date.now(),
      },
    ],
    getComputedStyle: () => ({ visibility: "visible", opacity: "1" }),
  };
  const result = runScrape(doc(), window, { href: "https://x.com/i/account_analytics/overview" });
  // 3540 (T1, duplicate counted once) + max(100, 50) at T2; non-verified,
  // Reply and HomeLinger rows ignored.
  assert.equal(result.verifiedImpressions, 3640);
  assert.equal(result.verifiedImpressionsSource, "captures");
  assert.equal(result.verifiedImpressionsWindowDays, 90);
  assert.equal(result.debug.verifiedImpressions.total, 3640);
});

test("null when no Displayed-verified rows captured", () => {
  const window = {
    __XCHROME_CAPTURES: [
      {
        url: "https://x.com/i/api/graphql/abc/AccountOverviewQuery",
        data: {
          data: {
            viewer_v2: {
              user_results: {
                result: {
                  verified_follower_count: "291",
                  current_time_series: [
                    { count: 8338, engagement_type: "Displayed", is_engaging_user_verified: "false", timestamp: T1 },
                  ],
                  hourly_backfill: [],
                },
              },
            },
          },
        },
        t: Date.now(),
      },
    ],
    getComputedStyle: () => ({ visibility: "visible", opacity: "1" }),
  };
  const result = runScrape(doc(), window, { href: "https://x.com/i/account_analytics/overview" });
  assert.equal(result.verifiedImpressions, null);
  assert.equal(result.verifiedImpressionsSource, null);
});

test("uses widest window instead of stacking overlapping periods", () => {
  const cap = (from, to, series) => ({
    url: `https://x.com/i/api/graphql/abc/AccountOverviewQuery?variables=%7B%22from_time%22%3A%22${from}T00%3A00%3A00.000Z%22%2C%22to_time%22%3A%22${to}T00%3A00%3A00.000Z%22`,
    data: {
      data: {
        viewer_v2: {
          user_results: {
            result: {
              verified_follower_count: "291",
              current_time_series: series,
              hourly_backfill: [],
            },
          },
        },
      },
    },
    t: Date.now(),
  });
  const window = {
    __XCHROME_CAPTURES: [
      cap("2026-08-27", "2026-09-03", [
        { count: 5000, engagement_type: "Displayed", is_engaging_user_verified: "true", timestamp: T1 },
      ]),
      cap("2026-06-05", "2026-09-03", [
        { count: 1500, engagement_type: "Displayed", is_engaging_user_verified: "true", timestamp: T1 },
        { count: 500, engagement_type: "Displayed", is_engaging_user_verified: "true", timestamp: T2 },
      ]),
    ],
    getComputedStyle: () => ({ visibility: "visible", opacity: "1" }),
  };
  const result = runScrape(doc(), window, { href: "https://x.com/i/account_analytics/overview" });
  // 90-day window wins (2000), NOT the stacked 7000.
  assert.equal(result.verifiedImpressions, 2000);
  assert.equal(result.verifiedImpressionsWindowDays, 90);
});

test("ignores previous_totals comparison period", () => {
  const window = {
    __XCHROME_CAPTURES: [
      {
        url: "https://x.com/i/api/graphql/abc/AccountOverviewQuery?variables=%7B%22from_time%22%3A%222026-06-05T00%3A00%3A00.000Z%22%2C%22to_time%22%3A%222026-09-03T00%3A00%3A00.000Z%22",
        data: {
          data: {
            viewer_v2: {
              user_results: {
                result: {
                  verified_follower_count: "291",
                  current_time_series: [
                    { count: 100, engagement_type: "Displayed", is_engaging_user_verified: "true", timestamp: T1 },
                  ],
                  hourly_backfill: [],
                  previous_totals: [
                    { count: 99999, engagement_type: "Displayed", is_engaging_user_verified: "true", timestamp: T1 - 7776000000 },
                  ],
                },
              },
            },
          },
        },
        t: Date.now(),
      },
    ],
    getComputedStyle: () => ({ visibility: "visible", opacity: "1" }),
  };
  const result = runScrape(doc(), window, { href: "https://x.com/i/account_analytics/overview" });
  assert.equal(result.verifiedImpressions, 100);
});
