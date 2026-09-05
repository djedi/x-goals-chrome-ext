import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildTrendSeries,
  mergeDay,
  mergeSeriesHistory,
  pruneHistory,
  recentDayKeys,
  seriesToHistory,
  summarizeTrend,
} from "../parse.js";

describe("pruneHistory", () => {
  it("keeps the newest 90 days", () => {
    const h = {};
    for (let i = 1; i <= 100; i += 1) {
      const d = `2026-${String(Math.floor((i - 1) / 30) + 1).padStart(2, "0")}-${String(((i - 1) % 30) + 1).padStart(2, "0")}`;
      h[d] = { replies: i };
    }
    const out = pruneHistory(h, 90);
    assert.equal(Object.keys(out).length, 90);
    assert.ok(!("2026-01-01" in out));
    assert.ok("2026-04-10" in out);
  });
});

describe("mergeDay", () => {
  it("fills gaps without overwriting fresh values", () => {
    let h = mergeDay({}, "2026-09-05", { replies: 5, posts: null });
    assert.deepEqual(h["2026-09-05"], { replies: 5 });
    h = mergeDay(h, "2026-09-05", { replies: 99, posts: 2 });
    assert.deepEqual(h["2026-09-05"], { replies: 5, posts: 2 });
    h = mergeDay(h, "2026-09-05", { replies: 99 }, { overwrite: true });
    assert.equal(h["2026-09-05"].replies, 99);
  });

  it("rejects bad day keys", () => {
    assert.deepEqual(mergeDay({}, "nope", { replies: 1 }), {});
  });
});

describe("seriesToHistory", () => {
  it("maps outbound chart rows to day keys", () => {
    const out = seriesToHistory(
      [
        { date: "2026-09-03", posts: 2, replies: 10 },
        { date: "2026-09-04", posts: 1, replies: 7 },
        { notOutbound: true },
      ],
      "America/Denver"
    );
    assert.deepEqual(out, {
      "2026-09-03": { replies: 10, posts: 2 },
      "2026-09-04": { replies: 7, posts: 1 },
    });
  });
});

describe("trend series", () => {
  it("builds a continuous axis with nulls for missing days", () => {
    const now = new Date("2026-09-05T12:00:00-06:00").getTime();
    const keys = recentDayKeys(5, now, "America/Denver");
    assert.deepEqual(keys, ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"]);
    const series = buildTrendSeries({ "2026-09-04": { replies: 3 } }, 5, now, "America/Denver");
    assert.equal(series.length, 5);
    assert.equal(series[3].replies, 3);
    assert.equal(series[0].replies, null);
  });

  it("summarizes totals and verified delta", () => {
    const s = summarizeTrend([
      { replies: 10, posts: 1, verified: 100 },
      { replies: null, posts: 2, verified: null },
      { replies: 5, posts: 0, verified: 115 },
    ]);
    assert.equal(s.totalReplies, 15);
    assert.equal(s.totalPosts, 3);
    assert.equal(s.verifiedDelta, 15);
  });

  it("merges backfill then prunes", () => {
    const h = mergeSeriesHistory({}, { "2026-09-03": { replies: 4, posts: 1 } });
    assert.equal(h["2026-09-03"].replies, 4);
  });
});
