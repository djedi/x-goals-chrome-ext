import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

// Extract the scrapeAnalytics function body from scrape.js and run it in a fake
// DOM shim with the real accountOverviewDailyQuery response captured.
const src = readFileSync(new URL("../scrape.js", import.meta.url), "utf8");
const inner = src
  .replace(/^\/\*\*[\s\S]*?\*\//, "")
  .replace("export function scrapeAnalytics() {", "")
  .replace(/\}\s*$/, "");

const payload = JSON.parse(readFileSync(new URL("./fixtures/daily-response.json", import.meta.url), "utf8"));

const consoleInfo = [];
function scrapeAnalyticsFactory(shim) {
  const { document, window, location, NodeFilter, MouseEvent, Number, JSON: J, Math: M, Object: O, Date: D, Set, Array: A, String: S, RegExp, Intl, Infinity: Inf } = shim;
  return new Function(
    "document", "window", "location", "NodeFilter", "MouseEvent", "Number", "JSON", "Math", "Object", "Date", "Set", "Array", "String", "RegExp", "Intl", "Infinity", "console",
    inner + "\nreturn scrapeAnalyticsShim && typeof scrapeAnalyticsShim === 'function' ? scrapeAnalyticsShim() : undefined;"
  );
}

// Simpler: eval the inner code which defines scrapeAnalytics as an inner declaration.
function runScrape(document, window, location) {
  const fn = new Function(
    "document", "window", "location", "NodeFilter", "MouseEvent", "console",
    `${inner}\nreturn scrapeAnalytics();`
  );
  return fn(document, window, location, shim.NodeFilter, shim.MouseEvent, shim.console);
}

const shim = {
  NodeFilter: { SHOW_TEXT: 4 },
  MouseEvent: class MouseEvent {
    constructor(type, opts) { this.type = type; Object.assign(this, opts || {}); }
  },
  console: { info: (...a) => consoleInfo.push(a) },
};

// Minimal fake document: body with text "Verified followers" nowhere needed since
// daily-query path should win.
const fakeBody = {
  innerText: "Account overview",
  textContent: "Account overview",
  querySelectorAll: () => [],
  querySelector: () => null,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
  parentElement: null,
};
const fakeDocument = {
  body: fakeBody,
  querySelectorAll: () => [],
  querySelector: () => null,
  createTreeWalker: () => ({ nextNode: () => false }),
};
const fakeWindow = {
  __XCHROME_CAPTURES: [
    {
      url: "https://x.com/i/api/graphql/_P1caq0YB4SVuEtFLPDMfQ/accountOverviewDailyQuery?variables=%7B%22current_from_iso%22%3A%222026-09-02T00%3A00%3A00.000Z%22",
      data: payload,
      t: Date.now(),
    },
  ],
  fetch: () => {},
  getComputedStyle: () => ({ visibility: "visible", opacity: "1" }),
};

const result = runScrape(fakeDocument, fakeWindow, {
  href: "https://x.com/i/account_analytics/overview",
});

console.log("result:", JSON.stringify(
  {
    ok: result.ok,
    loggedIn: result.loggedIn,
    verifiedFollowers: result.verifiedFollowers,
    repliesToday: result.repliesToday,
    repliesSource: result.repliesSource,
    daily: result.debug.dailyQuery,
  },
  null,
  2
));

// From the pasted real response: latest day (Sept 3) ReplyCreate=12,
// earlier day (Sept 2) = 80; verified_follower_count="291"
assert.equal(result.verifiedFollowers, 291, "verified followers from daily query");
assert.equal(result.repliesToday, 12, "replies posted today = latest day ReplyCreate only (not 7-day sum)");
assert.notEqual(result.repliesToday, 92, "must not sum multi-day ReplyCreate");
assert.equal(result.repliesSource, "daily-query");
assert.ok(result.loggedIn, "loggedIn via overview text");
assert.ok(result.ok, "ok");

console.log("daily-query extraction tests PASS");
