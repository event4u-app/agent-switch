import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";

import { rebind, restoreRebind, readBinding, RebindError, FRESHEN_FLOOR_MS, type RebindDeps } from "../src/rebind.js";
import { configDir } from "../src/profiles.js";

const NOW = 1_700_000_000_000;

function cred(token: string, expOffsetMs = 60 * 60 * 1000): string {
  return JSON.stringify({ claudeAiOauth: { accessToken: token, expiresAt: NOW + expOffsetMs } });
}

const pConfig = configDir("claude", "P");
const aConfig = configDir("claude", "A");
const pSvc = "svc:" + pConfig;
const aSvc = "svc:" + aConfig;
// Build paths with path.join so keys match rebind.ts (backslashes on Windows).
const aFile = path.join(aConfig, ".credentials.json");

interface Fake {
  kc: Map<string, string>;
  files: Map<string, string>;
  calls: string[];
  deps: RebindDeps;
}

function makeFake(opts: { platform?: NodeJS.Platform } = {}): Fake {
  const kc = new Map<string, string>();
  const files = new Map<string, string>();
  const calls: string[] = [];
  const deps: RebindDeps = {
    platform: opts.platform ?? "darwin",
    now: () => NOW,
    serviceNameFor: (dir) => "svc:" + dir,
    kcGet: (s) => kc.get(s) ?? null,
    kcAdd: (s, v) => {
      calls.push("kcAdd:" + s);
      kc.set(s, v);
      return true;
    },
    kcDelete: (s) => {
      calls.push("kcDelete:" + s);
      return kc.delete(s);
    },
    readFile: (p) => files.get(p) ?? null,
    writeFile: (p, d) => {
      calls.push("writeFile:" + p);
      files.set(p, d);
    },
    removeFile: (p) => {
      files.delete(p);
    },
    renameFile: (from, to) => {
      calls.push("rename:" + from);
      const v = files.get(from);
      if (v === undefined) throw new Error("ENOENT " + from);
      files.delete(from);
      files.set(to, v);
    },
    exists: (p) => files.has(p),
    withLock: async (target, fn) => {
      calls.push("lock:" + target);
      return await fn();
    },
  };
  return { kc, files, calls, deps };
}

test("rebind refuses on a non-macOS platform (R0.1 unproven)", async () => {
  const f = makeFake({ platform: "linux" });
  f.kc.set(pSvc, cred("tokP"));
  f.kc.set(aSvc, cred("tokA"));
  await assert.rejects(() => rebind({ account: "A", profile: "P" }, f.deps), RebindError);
  assert.equal(f.calls.filter((c) => c.startsWith("kcAdd")).length, 0, "no write attempted off-macOS");
});

test("rebind moves the target credential into the running store and empties the target store", async () => {
  const f = makeFake();
  f.kc.set(pSvc, cred("tokP"));
  f.kc.set(aSvc, cred("tokA"));
  const r = await rebind({ account: "A", profile: "P" }, f.deps);

  assert.equal(r.boundToProfile, "A");
  assert.equal(JSON.parse(f.kc.get(pSvc)!).claudeAiOauth.accessToken, "tokA", "running store now serves A");
  assert.equal(f.kc.has(aSvc), false, "target Keychain entry deleted — one live store");

  const m = readBinding(pConfig, f.deps);
  assert.ok(m, "binding marker written");
  assert.equal(m!.boundToProfile, "A");
  assert.equal(JSON.parse(m!.runningOwnCredential).claudeAiOauth.accessToken, "tokP", "own cred stashed");
  assert.equal(JSON.parse(m!.targetOrigCredential).claudeAiOauth.accessToken, "tokA", "target orig stashed");
});

test("rebind takes the lock BEFORE any credential mutation", async () => {
  const f = makeFake();
  f.kc.set(pSvc, cred("tokP"));
  f.kc.set(aSvc, cred("tokA"));
  await rebind({ account: "A", profile: "P" }, f.deps);
  const lockIdx = f.calls.findIndex((c) => c === "lock:" + pConfig);
  const firstMutation = f.calls.findIndex((c) => c.startsWith("kcAdd") || c.startsWith("kcDelete") || c.startsWith("writeFile"));
  assert.ok(lockIdx >= 0, "lock acquired");
  assert.ok(lockIdx < firstMutation, "lock precedes the first mutation");
});

test("rebind moves the target's plaintext file aside (never deletes it)", async () => {
  const f = makeFake();
  f.kc.set(pSvc, cred("tokP"));
  f.kc.set(aSvc, cred("tokA"));
  f.files.set(aFile, cred("tokA"));
  await rebind({ account: "A", profile: "P" }, f.deps);
  assert.equal(f.files.has(aFile), false, "target file moved out of the way");
  assert.equal(f.files.has(aFile + ".rebind-lent"), true, "target file preserved as a reversible backup");
  assert.equal(readBinding(pConfig, f.deps)!.targetFileMoved, true);
});

test("rebind refuses when the profile is already rebound", async () => {
  const f = makeFake();
  f.kc.set(pSvc, cred("tokP"));
  f.kc.set(aSvc, cred("tokA"));
  await rebind({ account: "A", profile: "P" }, f.deps);
  f.kc.set(aSvc, cred("tokA")); // pretend A logged in again
  await assert.rejects(() => rebind({ account: "A", profile: "P" }, f.deps), /already rebound/);
});

test("rebind refuses a near-expiry target (dead-token guard, no minting)", async () => {
  const f = makeFake();
  f.kc.set(pSvc, cred("tokP"));
  f.kc.set(aSvc, cred("tokA", FRESHEN_FLOOR_MS - 60_000)); // < 10 min to expiry
  await assert.rejects(() => rebind({ account: "A", profile: "P" }, f.deps), /expires in/);
  assert.equal(f.kc.has(aSvc), true, "nothing mutated on refusal");
});

test("rebind is a no-op when the profile already runs that account", async () => {
  const f = makeFake();
  f.kc.set(pSvc, cred("same"));
  f.kc.set(aSvc, cred("same"));
  await assert.rejects(() => rebind({ account: "A", profile: "P" }, f.deps), /already running/);
});

test("restore reverses the rebind: both stores restored, marker cleared, file returned", async () => {
  const f = makeFake();
  f.kc.set(pSvc, cred("tokP"));
  f.kc.set(aSvc, cred("tokA"));
  f.files.set(aFile, cred("tokA"));
  await rebind({ account: "A", profile: "P" }, f.deps);

  const r = await restoreRebind({ profile: "P" }, f.deps);
  assert.equal(r.wasBoundTo, "A");
  assert.equal(JSON.parse(f.kc.get(pSvc)!).claudeAiOauth.accessToken, "tokP", "running restored to own account");
  assert.equal(JSON.parse(f.kc.get(aSvc)!).claudeAiOauth.accessToken, "tokA", "target store restored");
  assert.equal(f.files.has(aFile), true, "target file returned");
  assert.equal(f.files.has(aFile + ".rebind-lent"), false, "backup consumed");
  assert.equal(readBinding(pConfig, f.deps), null, "marker cleared");
});

test("restore refuses when there is no active rebind", async () => {
  const f = makeFake();
  await assert.rejects(() => restoreRebind({ profile: "P" }, f.deps), /no active rebind/);
});
