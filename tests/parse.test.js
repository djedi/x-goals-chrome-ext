import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  dayKey,
  extractRewardsProgress,
  isOutboundContentRow,
  outboundPostsFromRow,
  outboundRepliesFromRow,
  parseAnalyticsHtml,
  parseCompactNumber,
  parseNumberFlowPayload,
  pickTodayOutboundRow,
} from "../parse.js";

const fixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "fixtures/analytics-cards.html"),
  "utf8"
);

test("parses compact numbers", () => {
  assert.equal(parseCompactNumber("289"), 289);
  assert.equal(parseCompactNumber("1.2K"), 1200);
  assert.equal(parseCompactNumber("35.9K"), 35900);
  assert.equal(parseCompactNumber("110%"), 110);
  assert.equal(parseCompactNumber("-32%"), -32);
});

test("parses number-flow payload from saved analytics HTML", () => {
  const payload =
    "{&quot;pre&quot;:[],&quot;integer&quot;:[],&quot;fraction&quot;:[],&quot;post&quot;:[],&quot;valueAsString&quot;:&quot;289&quot;,&quot;value&quot;:289}";
  assert.equal(parseNumberFlowPayload(payload), 289);
});

test("extracts verified followers and inbound replies card from the saved dashboard", () => {
  const metrics = parseAnalyticsHtml(fixture);
  assert.equal(metrics.verifiedFollowers, 289);
  assert.equal(metrics.repliesReceived, 123);
  assert.equal(metrics.likes, 390);
  assert.equal(metrics.engagements, 673);
  assert.equal(metrics.profileVisits, 146);
});

test("dayKey is YYYY-MM-DD in the given zone", () => {
  const key = dayKey(Date.parse("2026-09-02T18:00:00Z"), "America/Denver");
  assert.equal(key, "2026-09-02");
});

test("ignores inbound-only reply series and reads Posts+Replies as authored replies", () => {
  assert.equal(isOutboundContentRow({ replies: 27, likes: 50 }), false);
  assert.equal(outboundRepliesFromRow({ replies: 27, likes: 50 }), null);
  assert.equal(outboundRepliesFromRow({ Posts: 5, Replies: 47 }), 47);
  assert.equal(outboundPostsFromRow({ Posts: 5, Replies: 47 }), 5);
  assert.equal(outboundPostsFromRow({ replies: 27, likes: 50 }), null);

  const row = pickTodayOutboundRow(
    [
      { date: "2026-09-01", Posts: 4, Replies: 44 },
      { date: "2026-09-02", Posts: 5, Replies: 47 },
      { date: "2026-09-02", replies: 27, likes: 50 },
    ],
    Date.parse("2026-09-02T18:00:00Z"),
    "America/Denver"
  );
  assert.equal(row.Replies, 47);
  assert.equal(outboundPostsFromRow(row), 5);
});

test("reads official rewards progress from eligibility page text", () => {
  const text = [
    "You're a few steps away from joining the Original Content Rewards Program.",
    "Have at least 500 Verified followers",
    "295",
    "Have at least 500K Verified Home Timeline impressions in the last 90 days",
    "11.6K",
    "Does not include replies",
  ].join("\n");
  const got = extractRewardsProgress(text);
  assert.equal(got.verifiedFollowers, 295);
  assert.equal(got.impressions90d, 11600);
});
