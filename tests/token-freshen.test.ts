import { test } from "node:test";
import assert from "node:assert/strict";

import {
  EXPIRY_BUFFER_MS,
  FreshenDeps,
  freshAccessToken,
  freshenToken,
  needsFreshen,
  tokenExpiresAt,
} from "../src/token-freshen.js";

const NOW = Date.parse("2026-07-25T12:00:00.000Z");

function cred(expiresAt: number | null, accessToken = "tok-a"): string {
  const oauth: Record<string, unknown> = { accessToken, refreshToken: "ref" };
  if (expiresAt !== null) oauth.expiresAt = expiresAt;
  return JSON.stringify({ claudeAiOauth: oauth });
}

/** A deps harness with recording seams; `store` is the credential the "store"
 *  holds, and `refreshTo` is what a health-check run replaces it with. */
function harness(opts: {
  store: string | null;
  refreshTo?: string | null;
  lastAttempt?: number;
  healthCheckOk?: boolean;
  now?: number;
  cooldownMs?: number;
}): { deps: FreshenDeps; runs: string[]; attempts: number[] } {
  const runs: string[] = [];
  const attempts: number[] = [];
  let store = opts.store;
  const deps: FreshenDeps = {
    now: () => opts.now ?? NOW,
    readCredential: () => store,
    readLastAttempt: () => opts.lastAttempt ?? 0,
    recordAttempt: (_dir, at) => attempts.push(at),
    runHealthCheck: (dir) => {
      runs.push(dir);
      if (opts.healthCheckOk === false) return false;
      if (opts.refreshTo !== undefined) store = opts.refreshTo;
      return true;
    },
    cooldownMs: opts.cooldownMs ?? 10 * 60 * 1000,
    bufferMs: EXPIRY_BUFFER_MS,
  };
  return { deps, runs, attempts };
}

test("tokenExpiresAt: reads the claim, null on absent / unparseable", () => {
  assert.equal(tokenExpiresAt(cred(NOW + 1000)), NOW + 1000);
  assert.equal(tokenExpiresAt(cred(null)), null);
  assert.equal(tokenExpiresAt("not json"), null);
  assert.equal(tokenExpiresAt(null), null);
  assert.equal(tokenExpiresAt(JSON.stringify({ claudeAiOauth: { expiresAt: "soon" } })), null);
});

test("needsFreshen: spent once inside the buffer, not before", () => {
  assert.equal(needsFreshen(cred(NOW + EXPIRY_BUFFER_MS + 1_000), NOW), false);
  assert.equal(needsFreshen(cred(NOW + EXPIRY_BUFFER_MS - 1_000), NOW), true);
  assert.equal(needsFreshen(cred(NOW - 1_000), NOW), true);
});

// No evidence of expiry is NOT evidence of expiry — spawning Claude Code on an
// unreadable credential would burn a process on every poll for a profile that
// simply has not run yet.
test("needsFreshen: unreadable / claimless credential is never reported spent", () => {
  assert.equal(needsFreshen(null, NOW), false);
  assert.equal(needsFreshen("not json", NOW), false);
  assert.equal(needsFreshen(cred(null), NOW), false);
});

test("freshenToken: a live token is left alone — no health check, no attempt stamp", () => {
  const h = harness({ store: cred(NOW + 60 * 60 * 1000) });
  assert.equal(freshenToken("/cfg", h.deps), "not-needed");
  assert.deepEqual(h.runs, []);
  assert.deepEqual(h.attempts, []);
});

test("freshenToken: an expired token is refreshed via the health check", () => {
  const h = harness({ store: cred(NOW - 1_000), refreshTo: cred(NOW + 8 * 60 * 60 * 1000, "tok-b") });
  assert.equal(freshenToken("/cfg", h.deps), "refreshed");
  assert.deepEqual(h.runs, ["/cfg"]);
  assert.deepEqual(h.attempts, [NOW]);
});

// The cooldown is what keeps a genuinely dead login (refresh token revoked or
// expired) from spawning a process on every GUI refresh cycle.
test("freshenToken: within the cooldown nothing is spawned", () => {
  const h = harness({ store: cred(NOW - 1_000), lastAttempt: NOW - 60_000, cooldownMs: 10 * 60 * 1000 });
  assert.equal(freshenToken("/cfg", h.deps), "cooling-down");
  assert.deepEqual(h.runs, []);
});

test("freshenToken: past the cooldown it tries again", () => {
  const h = harness({
    store: cred(NOW - 1_000),
    refreshTo: cred(NOW + 8 * 60 * 60 * 1000, "tok-b"),
    lastAttempt: NOW - 11 * 60 * 1000,
    cooldownMs: 10 * 60 * 1000,
  });
  assert.equal(freshenToken("/cfg", h.deps), "refreshed");
  assert.deepEqual(h.runs, ["/cfg"]);
});

test("freshenToken: a missing / unspawnable claude binary degrades to unavailable", () => {
  const h = harness({ store: cred(NOW - 1_000), healthCheckOk: false });
  assert.equal(freshenToken("/cfg", h.deps), "unavailable");
  // The attempt is still stamped: an uninstalled CLI must not be retried on
  // every cycle either.
  assert.deepEqual(h.attempts, [NOW]);
});

// A dead login runs the health check but the store stays expired — reported
// honestly rather than as a refresh, and the stamp holds off the next attempt.
test("freshenToken: health check ran but the token is still spent", () => {
  const h = harness({ store: cred(NOW - 1_000), refreshTo: cred(NOW - 500) });
  assert.equal(freshenToken("/cfg", h.deps), "still-expired");
  assert.deepEqual(h.runs, ["/cfg"]);
});

test("freshAccessToken: returns the token the store holds AFTER the freshen", () => {
  const h = harness({ store: cred(NOW - 1_000, "tok-old"), refreshTo: cred(NOW + 8 * 60 * 60 * 1000, "tok-new") });
  assert.equal(freshAccessToken("/cfg", h.deps), "tok-new");
});

test("freshAccessToken: an untouched live token comes back unchanged", () => {
  const h = harness({ store: cred(NOW + 60 * 60 * 1000, "tok-live") });
  assert.equal(freshAccessToken("/cfg", h.deps), "tok-live");
  assert.deepEqual(h.runs, []);
});

test("freshAccessToken: no credential at all → null, and nothing is spawned", () => {
  const h = harness({ store: null });
  assert.equal(freshAccessToken("/cfg", h.deps), null);
  assert.deepEqual(h.runs, []);
});
