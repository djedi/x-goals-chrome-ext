import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";

// Runs the real scrapeRewards against a fake rewards page (text as observed
// on x.com/i/jf/creators/original_content_rewards).
const src = readFileSync(new URL("../scrape.js", import.meta.url), "utf8");
const start = src.indexOf("export function scrapeRewards()");
assert.notEqual(start, -1, "scrapeRewards found in scrape.js");
const inner = src
  .slice(start)
  .replace("export function scrapeRewards() {", "")
  .replace(/\}\s*$/, "");

const PAGE_TEXT = [
  "Dustin Davis",
  "Check back later",
  "You're a few steps away from joining the Original Content Rewards Program and getting paid for posting original content. To enroll, you must:",
  "Subscribe to Premium, Premium+, or Premium Business",
  "Be at least 18 years old",
  "Have at least 500 Verified followers",
  "295",
  "Have at least 500K Verified Home Timeline impressions in the last 90 days",
  "11.6K",
  "Does not include replies",
  "Click here for more details on the Original Content Rewards Program.",
].join("\n");

function runRewards(innerText, href = "https://x.com/i/jf/creators/original_content_rewards") {
  const fn = new Function(
    "document",
    "window",
    "location",
    "NodeFilter",
    "MouseEvent",
    "console",
    `${inner}\nreturn scrapeRewards();`
  );
  const document = {
    body: { innerText, textContent: innerText },
    title: "X",
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  return fn(
    document,
    {},
    { href },
    { SHOW_TEXT: 4 },
    class MouseEvent {},
    { info: () => {} }
  );
}

test("scrapes official rewards counts from rendered text", () => {
  const result = runRewards(PAGE_TEXT);
  assert.equal(result.loginWall, false);
  assert.equal(result.loggedIn, true);
  assert.equal(result.rewardsVerifiedFollowers, 295);
  assert.equal(result.rewardsImpressions90d, 11600);
  assert.equal(result.ok, true);
});

test("nulls when labels absent, flags login wall", () => {
  const empty = runRewards("Something else entirely");
  assert.equal(empty.rewardsImpressions90d, null);
  assert.equal(empty.ok, false);
  const walled = runRewards("Log in", "https://x.com/i/flow/login");
  assert.equal(walled.loginWall, true);
  assert.equal(walled.loggedIn, false);
});
