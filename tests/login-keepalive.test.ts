import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CODEX_REFRESH_REQUEST,
  KeepAliveDeps,
  STALE_AFTER_MS,
  agyAccessExpiry,
  codexAccessExpiry,
  keepAlive,
  keepAliveDue,
  runsOnProfile,
  profilesWithSession,
  sessionCounts,
} from "../src/login-keepalive.js";

const NOW = Date.parse("2026-11-01T12:00:00.000Z");
const DAY = 24 * 60 * 60_000;

function jwt(expSeconds: number): string {
  return `h.${Buffer.from(JSON.stringify({ exp: expSeconds })).toString("base64url")}.s`;
}

function codexAuth(o: { exp?: number; refresh?: string; apiKey?: string }): string {
  return JSON.stringify({
    ...(o.apiKey ? { OPENAI_API_KEY: o.apiKey } : {}),
    tokens: { access_token: o.exp === undefined ? "opaque" : jwt(o.exp / 1000), refresh_token: o.refresh ?? "r" },
    last_refresh: "2026-07-14T19:23:26Z",
  });
}

function agyItem(token: Record<string, unknown>): string {
  return "go-keyring-base64:" + Buffer.from(JSON.stringify({ token, auth_method: "oauth" })).toString("base64");
}

test("keepAliveDue: due once the access token is past the provider's grace, never on an unreadable expiry", () => {
  assert.equal(keepAliveDue(null, NOW, 0), false);
  assert.equal(keepAliveDue(NOW + 1, NOW, 0), false);
  assert.equal(keepAliveDue(NOW, NOW, 0), true);
  const agy = STALE_AFTER_MS.antigravity;
  assert.equal(keepAliveDue(NOW - agy + 1, NOW, agy), false);
  assert.equal(keepAliveDue(NOW - agy, NOW, agy), true);
});

test("codexAccessExpiry: reads the access token's exp, and nothing for logins that have nothing to refresh", () => {
  const exp = NOW - 3 * DAY;
  assert.equal(codexAccessExpiry(codexAuth({ exp })), exp);
  assert.equal(codexAccessExpiry(codexAuth({ exp, apiKey: "sk-x" })), null);
  assert.equal(codexAccessExpiry(codexAuth({ exp, refresh: "" })), null);
  assert.equal(codexAccessExpiry(codexAuth({})), null);
  assert.equal(codexAccessExpiry("{not json"), null);
  assert.equal(codexAccessExpiry(null), null);
});

test("agyAccessExpiry: reads token.expiry from the go-keyring item, null without a refresh token", () => {
  const expiry = "2026-09-01T07:18:37.876959+02:00";
  assert.equal(agyAccessExpiry(agyItem({ access_token: "a", refresh_token: "r", expiry })), Date.parse(expiry));
  assert.equal(agyAccessExpiry(agyItem({ access_token: "a", expiry })), null);
  assert.equal(agyAccessExpiry(agyItem({ access_token: "a", refresh_token: "r", expiry: "never" })), null);
  assert.equal(agyAccessExpiry("go-keyring-base64:@@@"), null);
  assert.equal(agyAccessExpiry(null), null);
});

test("runsOnProfile: a process on this profile, or one whose environment is unreadable, is a session", () => {
  const dir = "/u/.agent-switch/codex/Work/config";
  const envs: Record<number, string | null> = {
    1: `/opt/codex/bin/codex resume CODEX_HOME=${dir} TERM=xterm`,
    2: `/opt/codex/bin/codex CODEX_HOME=${dir}2 TERM=xterm`,
    3: `PATH=/bin\0CODEX_HOME=${dir}\0HOME=/u`,
    4: null,
    5: "/opt/codex/bin/codex TERM=xterm",
  };
  const envOf = (pid: number) => envs[pid] ?? null;
  assert.equal(runsOnProfile([], "CODEX_HOME", dir, envOf), false);
  assert.equal(runsOnProfile([1], "CODEX_HOME", dir, envOf), true, "ps -E form");
  assert.equal(runsOnProfile([3], "CODEX_HOME", dir, envOf), true, "/proc environ form");
  assert.equal(runsOnProfile([2, 5], "CODEX_HOME", dir, envOf), false, "a longer path and the default home are other profiles");
  assert.equal(runsOnProfile([5, 4], "CODEX_HOME", dir, envOf), true, "unreadable counts as live");
  assert.equal(runsOnProfile([1], "CODEX_HOME", "/u/a b", () => "codex CODEX_HOME=/u/a b TERM=x"), true, "a path with a space");
});

test("CODEX_REFRESH_REQUEST: initialize, initialized, then account/read with refreshToken", () => {
  const lines = CODEX_REFRESH_REQUEST.trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(
    lines.map((m) => m.method),
    ["initialize", "initialized", "account/read"],
  );
  assert.deepEqual(lines[2], { jsonrpc: "2.0", id: 2, method: "account/read", params: { refreshToken: true } });
  assert.ok(CODEX_REFRESH_REQUEST.endsWith("\n"));
});

function harness(o: { expiry: number | null; refreshTo?: number | null; lastAttempt?: number; refreshOk?: boolean }) {
  let expiry = o.expiry;
  const runs: string[] = [];
  const attempts: number[] = [];
  const deps: KeepAliveDeps = {
    now: () => NOW,
    readExpiry: () => expiry,
    readLastAttempt: () => o.lastAttempt ?? 0,
    recordAttempt: (_d, at) => void attempts.push(at),
    refresh: async (dir) => {
      runs.push(dir);
      if (o.refreshOk === false) return "codex: ENOENT";
      if (o.refreshTo !== undefined) expiry = o.refreshTo;
      return true;
    },
    cooldownMs: 10 * 60_000,
    staleAfterMs: 0,
  };
  return { deps, runs, attempts };
}

test("keepAlive: refreshes a due login and judges the result by re-reading the expiry", async () => {
  const h = harness({ expiry: NOW - DAY, refreshTo: NOW + 10 * DAY });
  assert.deepEqual(await keepAlive("/p", h.deps), { outcome: "refreshed" });
  assert.deepEqual(h.runs, ["/p"]);
  assert.deepEqual(h.attempts, [NOW]);
});

test("keepAlive: a dead login is reported, not retried inside the cooldown", async () => {
  const dead = harness({ expiry: NOW - 100 * DAY });
  assert.equal((await keepAlive("/p", dead.deps)).outcome, "still-expired");
  const cooling = harness({ expiry: NOW - 100 * DAY, lastAttempt: NOW - 60_000 });
  assert.equal((await keepAlive("/p", cooling.deps)).outcome, "cooling-down");
  assert.deepEqual(cooling.runs, []);
});

test("keepAlive: nothing runs for a fresh or unreadable login; a CLI that cannot start is named", async () => {
  const fresh = harness({ expiry: NOW + DAY });
  assert.equal((await keepAlive("/p", fresh.deps)).outcome, "not-needed");
  const unreadable = harness({ expiry: null });
  assert.equal((await keepAlive("/p", unreadable.deps)).outcome, "not-needed");
  assert.deepEqual([...fresh.runs, ...unreadable.runs], []);
  const missing = harness({ expiry: NOW - DAY, refreshOk: false });
  assert.deepEqual(await keepAlive("/p", missing.deps), { outcome: "unavailable", reason: "codex: ENOENT" });
});

test("profilesWithSession: the profiles a running CLI process serves, from one process list", () => {
  const env: Record<number, string | null> = {
    1: "CODEX_HOME=/as/codex/a/config\0PATH=/bin",
    2: "CODEX_HOME=/as/codex/b/config",
  };
  const dirOf = (n: string) => `/as/codex/${n}/config`;
  assert.deepEqual([...profilesWithSession([1, 2], ["a", "b", "c"], "CODEX_HOME", dirOf, (p) => env[p] ?? null)].sort(), ["a", "b"]);
  assert.deepEqual([...profilesWithSession([], ["a"], "CODEX_HOME", dirOf, () => null)], [], "no process, no session");
});

test("sessionCounts: running processes per profile; an unreadable environment counts for none", () => {
  const env: Record<number, string | null> = {
    1: "CODEX_HOME=/as/codex/a/config",
    2: "CODEX_HOME=/as/codex/a/config",
    3: "CODEX_HOME=/as/codex/b/config",
    4: null,
    5: "CODEX_HOME=/as/codex/a/configX",
  };
  const counts = sessionCounts([1, 2, 3, 4, 5], ["a", "b", "c"], "CODEX_HOME", (n) => `/as/codex/${n}/config`, (p) => env[p] ?? null);
  assert.deepEqual(Object.fromEntries(counts), { a: 2, b: 1, c: 0 });
});
