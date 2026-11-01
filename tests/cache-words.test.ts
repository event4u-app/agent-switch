import { test } from "node:test";
import assert from "node:assert/strict";

import { clock, compactCacheLine, formatCache, moveCacheLine } from "../src/cache-words.js";
import type { CacheReading } from "../src/telemetry.js";

const NOW = Date.parse("2026-11-01T10:30:00.000Z");

function reading(over: Partial<CacheReading>): CacheReading {
  return {
    state: "warm",
    ttl: "1h",
    lastResponseAt: "2026-11-01T10:00:00.000Z",
    expiresAt: "2026-11-01T11:00:00.000Z",
    resendTokens: 182_340,
    source: "transcript",
    ...over,
  };
}

const warm = reading({});
// Expired 23 minutes before NOW.
const cold = reading({ state: "cold", lastResponseAt: "2026-11-01T09:07:00.000Z", expiresAt: "2026-11-01T10:07:00.000Z" });

test("formatCache: one short column per state, nothing when unknown", () => {
  assert.equal(formatCache(warm), `cache warm till ${clock(warm.expiresAt!)}`);
  assert.equal(formatCache(cold), "cache cold · ~182k re-sent");
  assert.equal(formatCache(reading({ state: "compacted", resendTokens: null })), "cache compacted");
  assert.equal(formatCache(reading({ state: "unknown", expiresAt: null })), "");
  assert.equal(formatCache(null), "");
  assert.equal(formatCache(reading({ state: "cold", resendTokens: 512 })), "cache cold · ~512 re-sent");
});

test("clock: local HH:MM of the instant", () => {
  const d = new Date(warm.expiresAt!);
  assert.equal(clock(warm.expiresAt!), `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
});

test("moveCacheLine: cold costs the same as staying, whatever the organization", () => {
  for (const org of [true, false, null]) {
    assert.equal(moveCacheLine(cold, "MatneX", org, NOW), "Cache: cold for 23 min — the first turn on MatneX re-sends ~182k, same as staying.");
  }
});

test("moveCacheLine: warm + same organization → the cache moves along", () => {
  assert.equal(
    moveCacheLine(warm, "Matze", true, NOW),
    `Cache: warm till ${clock(warm.expiresAt!)} — Matze is in the same organization, so the cache moves with the session.`,
  );
});

test("moveCacheLine: warm + other organization → the target re-sends the conversation", () => {
  assert.equal(
    moveCacheLine(warm, "MatneX", false, NOW),
    `Cache: warm till ${clock(warm.expiresAt!)} here, but MatneX is another organization — its first turn re-sends ~182k.`,
  );
});

test("moveCacheLine: unknown organization says so instead of guessing", () => {
  assert.equal(
    moveCacheLine(warm, "X", null, NOW),
    `Cache: warm till ${clock(warm.expiresAt!)} here — if X is another organization, its first turn re-sends ~182k.`,
  );
});

test("moveCacheLine: nothing to say after a compaction, without a reading, or unknown + same org", () => {
  assert.equal(moveCacheLine(reading({ state: "compacted", resendTokens: null }), "X", false, NOW), null);
  assert.equal(moveCacheLine(null, "X", false, NOW), null);
  assert.equal(moveCacheLine(reading({ state: "unknown", expiresAt: null }), "X", true, NOW), null);
  assert.equal(
    moveCacheLine(reading({ state: "unknown", expiresAt: null }), "X", false, NOW),
    "Cache: state unknown, but X is another organization — its first turn re-sends ~182k.",
  );
});

test("moveCacheLine: a host-reported cold without expiry, and long gaps in hours", () => {
  assert.equal(moveCacheLine(reading({ state: "cold", expiresAt: null, source: "host" }), "X", true, NOW), "Cache: cold — the first turn on X re-sends ~182k, same as staying.");
  const old = reading({ state: "cold", expiresAt: "2026-11-01T05:30:00.000Z" });
  assert.match(moveCacheLine(old, "X", true, NOW)!, /cold for 5 h/);
});

test("compactCacheLine: only a cold session gets a word before /compact", () => {
  assert.equal(compactCacheLine(cold, NOW), "Cache cold for 23 min: this /compact re-reads ~182k as uncached input.");
  assert.equal(compactCacheLine({ ...cold, resendTokens: null }, NOW), "Cache cold for 23 min: this /compact re-reads the whole conversation as uncached input.");
  assert.equal(compactCacheLine(warm, NOW), null);
  assert.equal(compactCacheLine(reading({ state: "compacted" }), NOW), null);
  assert.equal(compactCacheLine(null, NOW), null);
});
