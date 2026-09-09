import assert from "node:assert/strict";
import test from "node:test";
import { mergeSnapshotMetrics } from "../parse.js";

const TODAY = "2026-09-09";
const NOW = Date.parse("2026-09-09T12:00:00-06:00");

const stored = {
  repliesToday: 42,
  repliesSource: "daily-query",
  repliesDayKey: TODAY,
  postsToday: 3,
  postsSource: "daily-query",
  postsDayKey: TODAY,
  verifiedFollowers: 510,
  verifiedImpressions: 400_000,
  verifiedImpressionsWindowDays: 90,
  verifiedImpressionsSource: "captures",
  verifiedImpressionsUpdatedAt: NOW - 3_600_000,
};

test("partial snapshot (replies only) keeps verified followers and impressions", () => {
  const out = mergeSnapshotMetrics(stored, {
    repliesToday: 43,
    repliesSource: "daily-query",
    postsToday: null,
    postsSource: null,
    verifiedFollowers: null,
    verifiedImpressions: null,
    verifiedImpressionsWindowDays: null,
  }, TODAY, NOW);
  assert.equal(out.repliesToday, 43);
  assert.equal(out.verifiedFollowers, 510);
  assert.equal(out.verifiedImpressions, 400_000);
  assert.equal(out.verifiedImpressionsWindowDays, 90);
  assert.equal(out.keepPosts, true);
  assert.equal(out.postsToday, 3);
});

test("null daily counts on the same day keep stored values even with lost source", () => {
  const poisoned = { ...stored, repliesSource: null, postsSource: null };
  const out = mergeSnapshotMetrics(poisoned, {
    repliesToday: null,
    postsToday: null,
    verifiedFollowers: 511,
  }, TODAY, NOW);
  assert.equal(out.repliesToday, 42);
  assert.equal(out.postsToday, 3);
  assert.equal(out.verifiedFollowers, 511);
});

test("null daily counts on a new day do not carry over", () => {
  const out = mergeSnapshotMetrics(stored, { repliesToday: null, postsToday: null }, "2026-09-10", NOW);
  assert.equal(out.repliesToday, null);
  assert.equal(out.postsToday, null);
  assert.equal(out.repliesSource, null);
  // Cumulative verified count still carries over across days.
  assert.equal(out.verifiedFollowers, 510);
});

test("fresh values always win when present", () => {
  const out = mergeSnapshotMetrics(stored, {
    repliesToday: 7,
    repliesSource: "chart-data",
    postsToday: 1,
    postsSource: "chart-data",
    verifiedFollowers: 520,
    verifiedImpressions: 410_000,
    verifiedImpressionsWindowDays: 90,
    verifiedImpressionsSource: "captures",
  }, TODAY, NOW);
  assert.equal(out.repliesToday, 7);
  assert.equal(out.repliesSource, "chart-data");
  assert.equal(out.postsToday, 1);
  assert.equal(out.verifiedFollowers, 520);
  assert.equal(out.verifiedImpressions, 410_000);
  assert.equal(out.verifiedImpressionsUpdatedAt, NOW);
});

test("narrow-window impressions estimate never replaces a wider one", () => {
  const out = mergeSnapshotMetrics(stored, {
    repliesToday: 43,
    verifiedFollowers: 510,
    verifiedImpressions: 12_000,
    verifiedImpressionsWindowDays: 7,
    verifiedImpressionsSource: "captures",
  }, TODAY, NOW);
  assert.equal(out.verifiedImpressions, 400_000);
  assert.equal(out.verifiedImpressionsWindowDays, 90);
  assert.equal(out.verifiedImpressionsUpdatedAt, NOW - 3_600_000);
});

test("wider-window impressions estimate is adopted", () => {
  const narrow = { ...stored, verifiedImpressions: 12_000, verifiedImpressionsWindowDays: 7 };
  const out = mergeSnapshotMetrics(narrow, {
    repliesToday: 43,
    verifiedFollowers: 510,
    verifiedImpressions: 400_000,
    verifiedImpressionsWindowDays: 90,
    verifiedImpressionsSource: "captures",
  }, TODAY, NOW);
  assert.equal(out.verifiedImpressions, 400_000);
  assert.equal(out.verifiedImpressionsWindowDays, 90);
  assert.equal(out.verifiedImpressionsUpdatedAt, NOW);
});

test("empty storage plus empty snapshot yields nulls, not undefined", () => {
  const out = mergeSnapshotMetrics({}, {}, TODAY, NOW);
  for (const key of [
    "repliesToday", "repliesSource", "postsToday", "postsSource", "verifiedFollowers",
    "verifiedImpressions", "verifiedImpressionsWindowDays",
    "verifiedImpressionsSource", "verifiedImpressionsUpdatedAt",
  ]) {
    assert.equal(out[key], null);
  }
});
