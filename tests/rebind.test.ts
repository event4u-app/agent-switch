import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";

import {
  rebind,
  restoreRebind,
  readBinding,
  readBindingRegistry,
  accountFingerprint,
  RebindError,
  FRESHEN_FLOOR_MS,
  REBIND_FAILURE_LIMIT,
  canaryCheck,
  PINNED_SERVICE_NAME_RE,
  type RebindDeps,
} from "../src/rebind.js";
import { configDir, ROOT, type RebindKillSwitch } from "../src/profiles.js";
import { serviceNameFor as realServiceNameFor } from "../src/keychain.js";

const NOW = 1_700_000_000_000;

function cred(token: string, expOffsetMs = 60 * 60 * 1000): string {
  return JSON.stringify({ claudeAiOauth: { accessToken: token, expiresAt: NOW + expOffsetMs } });
}

/** A credential carrying an extra `claudeAiOauth` payload (stable claim, scopes, …). */
function credWith(extra: Record<string, unknown>, token: string, expOffsetMs = 60 * 60 * 1000): string {
  return JSON.stringify({ claudeAiOauth: { ...extra, accessToken: token, expiresAt: NOW + expOffsetMs } });
}

const pConfig = configDir("claude", "P");
const aConfig = configDir("claude", "A");
// Use the REAL keychain derivation so service names carry the pinned canary
// shape ("Claude Code-credentials-<8hex>"); the fake's serviceNameFor matches.
const pSvc = realServiceNameFor(pConfig);
const aSvc = realServiceNameFor(aConfig);
// Build paths with path.join so keys match rebind.ts (backslashes on Windows).
const aFile = path.join(aConfig, ".credentials.json");
const pFile = path.join(pConfig, ".credentials.json");
const qConfig = configDir("claude", "Q");
const qSvc = realServiceNameFor(qConfig);
const registryFile = path.join(ROOT, ".agent-switch-rebind-registry.json");

interface Fake {
  kc: Map<string, string>;
  files: Map<string, string>;
  calls: string[];
  deps: RebindDeps;
  rebindState: RebindKillSwitch;
  /** Access token → account id, as the profile endpoint would answer. */
  accounts: Map<string, string>;
}

function makeFake(opts: { platform?: NodeJS.Platform; rebindState?: RebindKillSwitch } = {}): Fake {
  const kc = new Map<string, string>();
  const files = new Map<string, string>();
  const calls: string[] = [];
  const accounts = new Map<string, string>();
  const rebindState: RebindKillSwitch = opts.rebindState ?? { disabled: false, consecutiveFailures: 0 };
  const deps: RebindDeps = {
    platform: opts.platform ?? "darwin",
    now: () => NOW,
    serviceNameFor: (dir) => realServiceNameFor(dir),
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
    // Kill-switch state lives in an in-memory object shared across calls on this
    // fake, mirroring readState()/writeState() persistence.
    readRebindState: () => rebindState,
    writeRebindState: (s) => {
      rebindState.disabled = s.disabled;
      rebindState.consecutiveFailures = s.consecutiveFailures;
    },
    // Default: a no-op refresh that only records the call (a dead login that
    // `claude doctor` cannot heal). Tests that model a successful refresh
    // reassign this to update the target store.
    freshen: (dir) => {
      calls.push("freshen:" + dir);
    },
    // Default: the account endpoint answers from `accounts` (token → account id).
    // A token with no entry resolves to null, i.e. "cannot be established" —
    // the offline case. Tests reassign or seed `accounts` as needed.
    resolveAccount: async (cred) => {
      const tok = JSON.parse(cred)?.claudeAiOauth?.accessToken ?? "";
      calls.push("resolveAccount:" + tok);
      return accounts.get(tok) ?? null;
    },
  };
  return { kc, files, calls, deps, rebindState, accounts };
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

test("rebind on an already-rebound profile RE-SWITCHES: restore first, then bind the new target", async () => {
  const f = makeFake();
  f.kc.set(pSvc, cred("tokP"));
  f.kc.set(aSvc, cred("tokA"));
  f.kc.set(qSvc, cred("tokQ"));
  await rebind({ account: "A", profile: "P" }, f.deps); // P now serves A

  // The user switches AGAIN (what the GUI's "Switch account" does) — to Q. This
  // used to dead-end in "already rebound"; now it restores, then re-binds.
  const r = await rebind({ account: "Q", profile: "P" }, f.deps);
  assert.equal(r.boundToProfile, "Q");
  assert.equal(JSON.parse(f.kc.get(pSvc)!).claudeAiOauth.accessToken, "tokQ", "running store now serves Q");
  assert.equal(JSON.parse(f.kc.get(aSvc)!).claudeAiOauth.accessToken, "tokA", "A restored to its own account");
  assert.equal(f.kc.has(qSvc), false, "Q's own store emptied — one live store");
  assert.equal(readBinding(pConfig, f.deps)!.boundToProfile, "Q", "marker now records the Q binding");
  const reg = readBindingRegistry(f.deps);
  assert.equal(reg["A"], undefined, "old registry entry released");
  assert.equal(reg["Q"]?.runningProfile, "P", "new registry entry recorded");
});

test("re-switching BACK to the same account works (restore + fresh bind, not an error)", async () => {
  const f = makeFake();
  f.kc.set(pSvc, cred("tokP"));
  f.kc.set(aSvc, cred("tokA"));
  await rebind({ account: "A", profile: "P" }, f.deps);

  const r = await rebind({ account: "A", profile: "P" }, f.deps);
  assert.equal(r.boundToProfile, "A");
  assert.equal(JSON.parse(f.kc.get(pSvc)!).claudeAiOauth.accessToken, "tokA", "P still serves A");
  assert.equal(readBinding(pConfig, f.deps)!.boundToProfile, "A", "marker intact after the round-trip");
});

test("rebind attempts a refresh on a near-expiry target, then refuses if it stays dead", async () => {
  const f = makeFake();
  f.kc.set(pSvc, cred("tokP"));
  f.kc.set(aSvc, cred("tokA", FRESHEN_FLOOR_MS - 60_000)); // < 10 min to expiry
  // Default freshen is a no-op (a dead login `claude doctor` cannot heal), so the
  // token is still spent after the attempt → refuse without minting.
  await assert.rejects(() => rebind({ account: "A", profile: "P" }, f.deps), /still expires in/);
  assert.ok(f.calls.includes("freshen:" + aConfig), "a refresh was delegated before refusing");
  assert.equal(f.kc.has(aSvc), true, "nothing mutated on refusal");
});

test("rebind proceeds when a refresh heals the near-expiry target token", async () => {
  const f = makeFake();
  f.kc.set(pSvc, cred("tokP"));
  f.kc.set(aSvc, cred("tokA", FRESHEN_FLOOR_MS - 60_000)); // < 10 min to expiry
  // Model Claude Code refreshing the token in place: same account, fresh expiry.
  f.deps.freshen = (dir) => {
    f.calls.push("freshen:" + dir);
    f.kc.set(aSvc, cred("tokA-fresh", 60 * 60 * 1000));
  };
  const r = await rebind({ account: "A", profile: "P" }, f.deps);
  assert.equal(r.boundToProfile, "A");
  assert.ok(f.calls.includes("freshen:" + aConfig), "the refresh was delegated");
  assert.equal(
    JSON.parse(f.kc.get(pSvc)!).claudeAiOauth.accessToken,
    "tokA-fresh",
    "the freshened target token is what gets moved into the running store",
  );
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

// ---------- Feature 1: global binding registry + global lock ----------

test("rebind records the account in the global registry; restore removes it", async () => {
  const f = makeFake();
  f.kc.set(pSvc, cred("tokP"));
  f.kc.set(aSvc, cred("tokA"));

  await rebind({ account: "A", profile: "P" }, f.deps);
  assert.equal(readBindingRegistry(f.deps)["A"]?.runningProfile, "P", "registry gained the binding");
  assert.ok(f.files.has(registryFile), "registry file written");

  await restoreRebind({ profile: "P" }, f.deps);
  assert.equal(readBindingRegistry(f.deps)["A"], undefined, "registry entry removed on restore");
});

test("the global registry acquires its lock OUTER to CC's per-profile lock", async () => {
  const f = makeFake();
  f.kc.set(pSvc, cred("tokP"));
  f.kc.set(aSvc, cred("tokA"));
  await rebind({ account: "A", profile: "P" }, f.deps);
  const globalIdx = f.calls.findIndex((c) => c === "lock:" + path.join(ROOT, ".agent-switch-rebind-registry"));
  const profileIdx = f.calls.findIndex((c) => c === "lock:" + pConfig);
  assert.ok(globalIdx >= 0, "global registry lock acquired");
  assert.ok(globalIdx < profileIdx, "global lock precedes (is outer to) the per-profile lock");
});

test("rebind refuses binding an account already bound into a different profile (global lock)", async () => {
  const f = makeFake();
  // A is already registered as bound INTO profile "P".
  f.files.set(registryFile, JSON.stringify({ A: { runningProfile: "P", boundAt: "2026-07-24T00:00:00.000Z" } }) + "\n");
  // Attempt to bind A into a SECOND profile "Q" (both stores readable, A never emptied).
  f.kc.set(qSvc, cred("tokQ"));
  f.kc.set(aSvc, cred("tokA"));

  await assert.rejects(() => rebind({ account: "A", profile: "Q" }, f.deps), /already bound into running profile "P"/);
  assert.equal(JSON.parse(f.kc.get(qSvc)!).claudeAiOauth.accessToken, "tokQ", "Q store untouched");
  assert.equal(readBinding(qConfig, f.deps), null, "no marker on Q");
  assert.equal(readBindingRegistry(f.deps)["A"].runningProfile, "P", "registry still shows only the P binding");
});

// ---------- Feature 2: provenance-fingerprint mismatch states ----------

test("accountFingerprint: token rotation keeps identity; a different account changes it", () => {
  const claimA = { account: { uuid: "acct-A" } };
  assert.equal(
    accountFingerprint(credWith(claimA, "tok1")).id,
    accountFingerprint(credWith(claimA, "tok2")).id,
    "same account, rotated token → same fingerprint",
  );
  assert.notEqual(
    accountFingerprint(credWith(claimA, "tok1")).id,
    accountFingerprint(credWith({ account: { uuid: "acct-B" } }, "tok1")).id,
    "different account → different fingerprint",
  );
  assert.ok(accountFingerprint(credWith(claimA, "tok1")).id!.startsWith("claim:"), "stable claim wins");

  // Fallback hash path (no stable claim): still rotation-stable, account-sensitive.
  const s1 = credWith({ scopes: ["a", "b"] }, "tokX");
  const s2 = credWith({ scopes: ["a", "b"] }, "tokY");
  const s3 = credWith({ scopes: ["c"] }, "tokX");
  assert.equal(accountFingerprint(s1).id, accountFingerprint(s2).id, "fallback hash ignores token rotation");
  assert.notEqual(accountFingerprint(s1).id, accountFingerprint(s3).id, "fallback hash reflects the account payload");
  assert.ok(accountFingerprint(s1).id!.startsWith("sha256:"), "fallback uses a hash id");

  // Unparseable / missing claudeAiOauth → null id.
  assert.equal(accountFingerprint(null).id, null);
  assert.equal(accountFingerprint("{not-json").id, null);
  assert.equal(accountFingerprint(JSON.stringify({ foo: 1 })).id, null, "no claudeAiOauth object → null");
});

/** Make aSvc return `first` on the pre-lock read, `second` on the under-lock re-read. */
function withRotatingTarget(f: Fake, first: string, second: string): void {
  const origGet = f.deps.kcGet;
  let aReads = 0;
  f.deps.kcGet = (s) => {
    if (s === aSvc) {
      aReads++;
      return aReads === 1 ? first : second;
    }
    return origGet(s);
  };
}

test("swap, same account with a rotated token → proceeds, moving the FRESH credential", async () => {
  const f = makeFake();
  const claim = { account: { uuid: "acct-A" } };
  f.kc.set(pSvc, cred("tokP"));
  withRotatingTarget(f, credWith(claim, "tok-old"), credWith(claim, "tok-new"));

  await rebind({ account: "A", profile: "P" }, f.deps);
  assert.equal(JSON.parse(f.kc.get(pSvc)!).claudeAiOauth.accessToken, "tok-new", "moved the freshened token, not the stale pre-lock one");
  assert.equal(JSON.parse(readBinding(pConfig, f.deps)!.targetOrigCredential).claudeAiOauth.accessToken, "tok-new", "marker stashed the credential actually moved");
});

test("swap, target now holds a DIFFERENT account → quarantine, no swap", async () => {
  const f = makeFake();
  f.kc.set(pSvc, cred("tokP"));
  withRotatingTarget(f, credWith({ account: { uuid: "acct-A" } }, "tok-A"), credWith({ account: { uuid: "acct-B" } }, "tok-B"));

  await assert.rejects(() => rebind({ account: "A", profile: "P" }, f.deps), /re-logged/);
  assert.equal(JSON.parse(f.kc.get(pSvc)!).claudeAiOauth.accessToken, "tokP", "running store not clobbered");
  assert.equal(readBinding(pConfig, f.deps), null, "no marker written on quarantine");
  assert.equal(readBindingRegistry(f.deps)["A"], undefined, "no phantom registry entry on quarantine");
  assert.equal(JSON.parse(f.files.get(aFile + ".rebind-quarantine")!).claudeAiOauth.accessToken, "tok-B", "unexpected credential quarantined aside");
});

test("swap, target credential unparseable at swap time → refuse, no mutation", async () => {
  const f = makeFake();
  f.kc.set(pSvc, cred("tokP"));
  withRotatingTarget(f, credWith({ account: { uuid: "acct-A" } }, "tok-A"), "{corrupt-json");

  await assert.rejects(() => rebind({ account: "A", profile: "P" }, f.deps), /unparseable/);
  assert.equal(JSON.parse(f.kc.get(pSvc)!).claudeAiOauth.accessToken, "tokP", "running store untouched");
  assert.equal(readBinding(pConfig, f.deps), null, "no marker written");
  assert.equal(readBindingRegistry(f.deps)["A"], undefined, "no registry entry written");
});

test("restore refuses to clobber a running profile that was re-logged to a different account", async () => {
  const f = makeFake();
  f.kc.set(pSvc, cred("tokP"));
  f.kc.set(aSvc, credWith({ account: { uuid: "acct-A" } }, "tok-A"));
  await rebind({ account: "A", profile: "P" }, f.deps); // P now serves acct-A

  // Someone re-logs the RUNNING profile P into a brand-new account.
  f.kc.set(pSvc, credWith({ account: { uuid: "acct-C" } }, "tok-C"));

  await assert.rejects(() => restoreRebind({ profile: "P" }, f.deps), /re-logged/);
  assert.equal(JSON.parse(f.kc.get(pSvc)!).claudeAiOauth.accessToken, "tok-C", "the fresh login was NOT clobbered");
  assert.ok(readBinding(pConfig, f.deps), "marker left in place for manual recovery");
  assert.equal(JSON.parse(f.files.get(pFile + ".rebind-quarantine")!).claudeAiOauth.accessToken, "tok-C", "the fresh login was quarantined aside");
});

// ---------- Feature 3: rollback / kill-switch (circuit-breaker) ----------

test("rebind refuses immediately when the kill-switch is disabled", async () => {
  const f = makeFake({ rebindState: { disabled: true, consecutiveFailures: 3 } });
  f.kc.set(pSvc, cred("tokP"));
  f.kc.set(aSvc, cred("tokA"));
  await assert.rejects(() => rebind({ account: "A", profile: "P" }, f.deps), /disabled/);
  assert.equal(f.calls.filter((c) => c.startsWith("kcAdd")).length, 0, "no write attempted while disabled");
  assert.equal(f.rebindState.consecutiveFailures, 3, "a disabled-refusal does not advance the breaker");
});

test("three consecutive swap FAILURES trip the circuit-breaker", async () => {
  assert.equal(REBIND_FAILURE_LIMIT, 3, "this test assumes a limit of 3");
  const f = makeFake();
  f.kc.set(pSvc, cred("tokP"));
  f.kc.set(aSvc, cred("tokA"));
  f.files.set(aFile, cred("tokA"));
  // A genuine write-path failure: moving the target's plaintext file aside dies
  // mid-swap (before the marker is written, so every retry hits the same wall).
  f.deps.renameFile = () => {
    throw new Error("simulated rename failure (disk)");
  };

  await assert.rejects(() => rebind({ account: "A", profile: "P" }, f.deps), /simulated rename failure/);
  assert.deepEqual(f.rebindState, { disabled: false, consecutiveFailures: 1 });
  await assert.rejects(() => rebind({ account: "A", profile: "P" }, f.deps), /simulated rename failure/);
  assert.deepEqual(f.rebindState, { disabled: false, consecutiveFailures: 2 });
  await assert.rejects(() => rebind({ account: "A", profile: "P" }, f.deps), /Circuit-breaker tripped/);
  assert.deepEqual(f.rebindState, { disabled: true, consecutiveFailures: 3 });

  // Once tripped, the next attempt is refused up-front with the disabled message.
  await assert.rejects(() => rebind({ account: "A", profile: "P" }, f.deps), /disabled/);
});

test("guard REFUSALS never advance the circuit-breaker (the Matze4u failure mode)", async () => {
  const f = makeFake();
  f.kc.set(pSvc, cred("tokP"));
  // Refusal class 1: target not logged in — retry it three times.
  for (let i = 0; i < 3; i++) {
    await assert.rejects(() => rebind({ account: "A", profile: "P" }, f.deps), /no readable credential/);
  }
  // Refusal class 2: near-expiry target that a refresh cannot heal.
  f.kc.set(aSvc, cred("tokA", FRESHEN_FLOOR_MS - 60_000));
  for (let i = 0; i < 3; i++) {
    await assert.rejects(() => rebind({ account: "A", profile: "P" }, f.deps), /still expires in/);
  }
  assert.deepEqual(f.rebindState, { disabled: false, consecutiveFailures: 0 }, "six refusals, breaker untouched — rebind stays enabled");
});

test("a successful rebind resets the failure counter", async () => {
  const f = makeFake({ rebindState: { disabled: false, consecutiveFailures: 2 } });
  f.kc.set(pSvc, cred("tokP"));
  f.kc.set(aSvc, cred("tokA"));
  await rebind({ account: "A", profile: "P" }, f.deps);
  assert.deepEqual(f.rebindState, { disabled: false, consecutiveFailures: 0 }, "success clears the breaker counter");
});

test("restore still works while rebind is disabled (recovery path)", async () => {
  const f = makeFake();
  f.kc.set(pSvc, cred("tokP"));
  f.kc.set(aSvc, cred("tokA"));
  await rebind({ account: "A", profile: "P" }, f.deps); // succeed while enabled

  // Trip the kill-switch.
  f.rebindState.disabled = true;
  f.rebindState.consecutiveFailures = 3;
  await assert.rejects(() => rebind({ account: "A", profile: "P" }, f.deps), /disabled/);

  // Restore (the recovery path) is exempt and still runs.
  const r = await restoreRebind({ profile: "P" }, f.deps);
  assert.equal(r.wasBoundTo, "A");
  assert.equal(JSON.parse(f.kc.get(pSvc)!).claudeAiOauth.accessToken, "tokP", "running restored while disabled");
  assert.equal(JSON.parse(f.kc.get(aSvc)!).claudeAiOauth.accessToken, "tokA", "target restored while disabled");
  assert.equal(readBinding(pConfig, f.deps), null, "marker cleared");
});

test("resetting the kill-switch re-enables rebind (what `rebind --reset` does)", async () => {
  const f = makeFake({ rebindState: { disabled: true, consecutiveFailures: 3 } });
  f.kc.set(pSvc, cred("tokP"));
  f.kc.set(aSvc, cred("tokA"));
  await assert.rejects(() => rebind({ account: "A", profile: "P" }, f.deps), /disabled/);

  // `rebind --reset` → resetRebindKillSwitch() clears disabled + counter.
  f.deps.writeRebindState({ disabled: false, consecutiveFailures: 0 });

  const r = await rebind({ account: "A", profile: "P" }, f.deps);
  assert.equal(r.boundToProfile, "A");
  assert.deepEqual(f.rebindState, { disabled: false, consecutiveFailures: 0 });
});

// ---------- Feature 4: credential-store contract canary (Council finding 3) ----------

test("canary passes for the real Keychain service-name format", () => {
  const f = makeFake();
  // The fake derives service names via the REAL keychain derivation, which must
  // carry the pinned shape and be accepted by canaryCheck without throwing.
  assert.match(f.deps.serviceNameFor(pConfig), PINNED_SERVICE_NAME_RE);
  assert.doesNotThrow(() => canaryCheck(pConfig, f.deps));
});

test("canary refuses rebind BEFORE any mutation when the service-name format drifted", async () => {
  const f = makeFake();
  f.kc.set(pSvc, cred("tokP"));
  f.kc.set(aSvc, cred("tokA"));
  // Simulate Claude Code's credential-store naming drifting away from the pinned
  // "Claude Code-credentials-<8hex>" shape the Phase-0 spikes verified.
  f.deps.serviceNameFor = () => "SomeOtherApp-credentials";

  await assert.rejects(() => rebind({ account: "A", profile: "P" }, f.deps), /canary tripped/);
  assert.equal(
    f.calls.filter((c) => c.startsWith("kcAdd") || c.startsWith("kcDelete") || c.startsWith("writeFile")).length,
    0,
    "no credential mutation on a canary refusal",
  );
  assert.equal(readBinding(pConfig, f.deps), null, "no binding marker written on a canary refusal");
  assert.equal(f.rebindState.consecutiveFailures, 0, "a canary refusal does not advance the circuit-breaker");
});

// ---------- claim-less credentials: same-tier account collision ----------
//
// Real Claude Code credentials carry NO account claim — only tokens, scopes and
// the plan tier. Every account on one tier therefore produces the SAME fallback
// fingerprint, so "same fingerprint + different token" cannot mean "rotation"
// on its own. These tests pin the escalation to the account endpoint.

/** A credential shaped like a real one: no account claim, just tier + scopes. */
function teamCred(token: string, expOffsetMs = 60 * 60 * 1000): string {
  return credWith(
    { scopes: ["user:inference", "user:profile"], subscriptionType: "team", rateLimitTier: "default_claude_max_5x" },
    token,
    expOffsetMs,
  );
}

const ccFile = path.join(pConfig, ".claude.json");

function stampedConfig(email: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ oauthAccount: { emailAddress: email, accountUuid: "uuid-" + email }, ...extra });
}

function stampOf(f: Fake, file = ccFile): any {
  return JSON.parse(f.files.get(file)!).oauthAccount;
}

test("claim-less credentials of two DIFFERENT accounts on one tier are locally indistinguishable", () => {
  assert.equal(
    accountFingerprint(teamCred("tok-A")).id,
    accountFingerprint(teamCred("tok-B")).id,
    "two accounts, same tier, no claim → identical fingerprints (why the endpoint escalation exists)",
  );
});

test("swap, claim-less re-login to a DIFFERENT same-tier account → quarantine, no swap", async () => {
  const f = makeFake();
  f.kc.set(pSvc, teamCred("tokP"));
  withRotatingTarget(f, teamCred("tok-A"), teamCred("tok-B"));
  f.accounts.set("tok-A", "acct-A");
  f.accounts.set("tok-B", "acct-B"); // a foreign account the local hash cannot see

  await assert.rejects(() => rebind({ account: "A", profile: "P" }, f.deps), /re-logged/);
  assert.equal(JSON.parse(f.kc.get(pSvc)!).claudeAiOauth.accessToken, "tokP", "running store not clobbered");
  assert.equal(readBinding(pConfig, f.deps), null, "no marker written");
  assert.equal(readBindingRegistry(f.deps)["A"], undefined, "no phantom registry entry");
  assert.equal(
    JSON.parse(f.files.get(aFile + ".rebind-quarantine")!).claudeAiOauth.accessToken,
    "tok-B",
    "the foreign credential is quarantined, not moved",
  );
});

test("swap, claim-less genuine rotation → proceeds once the endpoint confirms one account", async () => {
  const f = makeFake();
  f.kc.set(pSvc, teamCred("tokP"));
  withRotatingTarget(f, teamCred("tok-old"), teamCred("tok-new"));
  f.accounts.set("tok-old", "acct-A");
  f.accounts.set("tok-new", "acct-A"); // same account, rotated token

  await rebind({ account: "A", profile: "P" }, f.deps);
  assert.equal(JSON.parse(f.kc.get(pSvc)!).claudeAiOauth.accessToken, "tok-new", "the freshened credential was moved");
});

test("swap refuses without mutating when the account cannot be verified (offline)", async () => {
  const f = makeFake();
  f.kc.set(pSvc, teamCred("tokP"));
  withRotatingTarget(f, teamCred("tok-old"), teamCred("tok-new"));
  // `accounts` stays empty → the endpoint answers nothing, as when offline.

  await assert.rejects(() => rebind({ account: "A", profile: "P" }, f.deps), /could not be verified/);
  assert.equal(JSON.parse(f.kc.get(pSvc)!).claudeAiOauth.accessToken, "tokP", "running store untouched");
  assert.equal(readBinding(pConfig, f.deps), null, "no marker written");
  assert.equal(readBindingRegistry(f.deps)["A"], undefined, "no registry entry written");
  assert.equal(f.rebindState.consecutiveFailures, 0, "an unverifiable account is a refusal, not a write-path failure");
});

test("restore never writes a claim-less FOREIGN credential into the target's store", async () => {
  const f = makeFake();
  f.kc.set(pSvc, teamCred("tokP"));
  f.kc.set(aSvc, teamCred("tok-A"));
  await rebind({ account: "A", profile: "P" }, f.deps); // P now serves A's account

  // P is re-logged into a different account — same tier, so locally identical.
  f.kc.set(pSvc, teamCred("tok-C"));
  f.accounts.set("tok-A", "acct-A");
  f.accounts.set("tok-C", "acct-C");

  await assert.rejects(() => restoreRebind({ profile: "P" }, f.deps), /re-logged/);
  assert.equal(f.kc.get(aSvc), undefined, "the foreign credential was NOT handed to the target profile");
  assert.equal(JSON.parse(f.kc.get(pSvc)!).claudeAiOauth.accessToken, "tok-C", "the fresh login was not clobbered");
  assert.ok(readBinding(pConfig, f.deps), "marker left in place for manual recovery");
});

test("restore refuses without mutating when the running account cannot be verified (offline)", async () => {
  const f = makeFake();
  f.kc.set(pSvc, teamCred("tokP"));
  f.kc.set(aSvc, teamCred("tok-A"));
  await rebind({ account: "A", profile: "P" }, f.deps);

  f.kc.set(pSvc, teamCred("tok-rotated")); // token moved, account unverifiable

  await assert.rejects(() => restoreRebind({ profile: "P" }, f.deps), /could not be verified/);
  assert.equal(f.kc.get(aSvc), undefined, "target store untouched");
  assert.equal(JSON.parse(f.kc.get(pSvc)!).claudeAiOauth.accessToken, "tok-rotated", "running store untouched");
  assert.ok(readBinding(pConfig, f.deps), "marker left in place — retry when online");
});

// ---------- identity stamp: `.claude.json` oauthAccount ----------

test("restore puts the profile's own identity stamp back after Claude Code overwrote it", async () => {
  const f = makeFake();
  f.kc.set(pSvc, cred("tokP"));
  f.kc.set(aSvc, credWith({ account: { uuid: "acct-A" } }, "tok-A"));
  f.files.set(ccFile, stampedConfig("own@example.com", { projects: { "/repo": { allowed: true } } }));

  await rebind({ account: "A", profile: "P" }, f.deps);
  // While rebound, Claude Code fetches the BORROWED account and stamps it here.
  f.files.set(ccFile, stampedConfig("lender@example.com", { projects: { "/repo": { allowed: true } } }));

  await restoreRebind({ profile: "P" }, f.deps);

  assert.equal(stampOf(f).emailAddress, "own@example.com", "the profile reports its own account again");
  assert.deepEqual(
    JSON.parse(f.files.get(ccFile)!).projects,
    { "/repo": { allowed: true } },
    "the rest of Claude Code's config is preserved",
  );
  assert.ok(f.calls.includes("lock:" + ccFile), "the rewrite cooperates with Claude Code's lock on the config FILE");
});

test("restore leaves the stamp alone when the profile was re-logged to a different account", async () => {
  const f = makeFake();
  f.kc.set(pSvc, cred("tokP"));
  f.kc.set(aSvc, credWith({ account: { uuid: "acct-A" } }, "tok-A"));
  f.files.set(ccFile, stampedConfig("own@example.com"));
  await rebind({ account: "A", profile: "P" }, f.deps);

  f.kc.set(pSvc, credWith({ account: { uuid: "acct-C" } }, "tok-C")); // genuine re-login
  f.files.set(ccFile, stampedConfig("fresh@example.com"));

  await assert.rejects(() => restoreRebind({ profile: "P" }, f.deps), /re-logged/);
  assert.equal(stampOf(f).emailAddress, "fresh@example.com", "a genuine new login's stamp is never overwritten");
});

test("restore does not rewrite an identity stamp that is already correct", async () => {
  const f = makeFake();
  f.kc.set(pSvc, cred("tokP"));
  f.kc.set(aSvc, credWith({ account: { uuid: "acct-A" } }, "tok-A"));
  f.files.set(ccFile, stampedConfig("own@example.com"));
  await rebind({ account: "A", profile: "P" }, f.deps);

  await restoreRebind({ profile: "P" }, f.deps); // stamp never got overwritten
  assert.equal(f.calls.filter((c) => c === "writeFile:" + ccFile).length, 0, "no pointless write to Claude Code's config");
  assert.equal(stampOf(f).emailAddress, "own@example.com");
});

test("restore works on a marker written before identity stamps were stashed", async () => {
  const f = makeFake();
  const own = cred("tokP");
  const target = credWith({ account: { uuid: "acct-A" } }, "tok-A");
  f.kc.set(pSvc, target); // as if P is serving A's account
  f.files.set(
    path.join(pConfig, ".agent-switch-rebind.json"),
    JSON.stringify({
      boundToProfile: "A",
      boundAt: new Date(NOW).toISOString(),
      runningOwnCredential: own,
      targetOrigCredential: target,
      targetFileMoved: false,
    }),
  );
  f.files.set(ccFile, stampedConfig("stale@example.com"));

  await restoreRebind({ profile: "P" }, f.deps);
  assert.equal(f.kc.get(pSvc), own, "credentials still restore without a stashed stamp");
  assert.equal(f.kc.get(aSvc), target, "the target got its own credential back");
  assert.equal(stampOf(f).emailAddress, "stale@example.com", "nothing to restore → the stamp is left untouched");
});
