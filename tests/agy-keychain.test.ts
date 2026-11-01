import { test } from "node:test";
import assert from "node:assert/strict";

import { agyKeychainPasswordCheck } from "../src/doctor.js";
import {
  agyKeychainPath,
  agyPasswordService,
  ensureAgyKeychain,
  type AgyKeychainDeps,
} from "../src/agy-keychain.js";

const HOME = "/Users/u/.agent-switch/antigravity/work/config";
const KC = agyKeychainPath(HOME);
const SVC = agyPasswordService(HOME);

interface Fake {
  deps: AgyKeychainDeps;
  calls: string[][];
  store: Map<string, string>;
  /** The profile keychain's current password, or null when it does not exist. */
  kc: { password: string | null };
}

function fake(opts: { kcPassword?: string | null; stored?: string; storeFails?: boolean; setPasswordFails?: boolean; pw?: string } = {}): Fake {
  const store = new Map<string, string>();
  if (opts.stored !== undefined) store.set(SVC, opts.stored);
  const kc = { password: opts.kcPassword === undefined ? null : opts.kcPassword };
  const calls: string[][] = [];
  const deps: AgyKeychainDeps = {
    platform: "darwin",
    exists: (p) => p === KC && kc.password !== null,
    mkdir: () => {},
    security: (args) => {
      calls.push(args);
      const [cmd] = args;
      if (cmd === "create-keychain") {
        kc.password = args[2];
        return true;
      }
      if (cmd === "unlock-keychain") return kc.password !== null && args[2] === kc.password;
      if (cmd === "set-keychain-password") {
        if (opts.setPasswordFails || kc.password === null || args[2] !== kc.password) return false;
        kc.password = args[4];
        return true;
      }
      return true;
    },
    getStored: (s) => store.get(s) ?? null,
    store: (s, v) => {
      if (opts.storeFails) return false;
      store.set(s, v);
      return true;
    },
    randomPassword: () => opts.pw ?? "a".repeat(64),
  };
  return { deps, calls, store, kc };
}

const cmds = (f: Fake) => f.calls.map((c) => c[0]);

test("agyPasswordService is stable, per-profile and agent-switch namespaced", () => {
  assert.match(SVC, /^agent-switch\.agy\.[0-9a-f]{16}$/);
  assert.equal(agyPasswordService(HOME), SVC);
  assert.notEqual(agyPasswordService("/Users/u/.agent-switch/antigravity/other/config"), SVC);
});

test("new profile: random password is stored in the login keychain before the keychain is created with it", () => {
  const f = fake({ pw: "N".repeat(64) });
  ensureAgyKeychain(HOME, f.deps);
  assert.equal(f.store.get(SVC), "N".repeat(64));
  assert.deepEqual(f.calls[0], ["create-keychain", "-p", "N".repeat(64), KC]);
  assert.ok(f.calls.some((c) => c[0] === "unlock-keychain" && c[2] === "N".repeat(64)));
  assert.ok(!f.calls.some((c) => c[0] === "unlock-keychain" && c[2] === ""));
});

test("new profile: if the password cannot be stored, fall back to the empty password", () => {
  const f = fake({ storeFails: true });
  ensureAgyKeychain(HOME, f.deps);
  assert.deepEqual(f.calls[0], ["create-keychain", "-p", "", KC]);
  assert.equal(f.kc.password, "");
});

test("keychain file missing but a password stored: recreate with the stored password", () => {
  const f = fake({ stored: "S".repeat(64) });
  ensureAgyKeychain(HOME, f.deps);
  assert.deepEqual(f.calls[0], ["create-keychain", "-p", "S".repeat(64), KC]);
});

test("existing protected profile: unlocks with the stored password, no create, no migration", () => {
  const f = fake({ kcPassword: "P".repeat(64), stored: "P".repeat(64) });
  ensureAgyKeychain(HOME, f.deps);
  assert.ok(!cmds(f).includes("create-keychain"));
  assert.ok(!cmds(f).includes("set-keychain-password"));
  assert.ok(f.calls.some((c) => c[0] === "unlock-keychain" && c[2] === "P".repeat(64)));
});

test("existing empty-password profile: migrates — stores first, then changes the password, then unlocks with it", () => {
  const f = fake({ kcPassword: "", pw: "M".repeat(64) });
  ensureAgyKeychain(HOME, f.deps);
  assert.equal(f.kc.password, "M".repeat(64));
  assert.equal(f.store.get(SVC), "M".repeat(64));
  const setIdx = cmds(f).indexOf("set-keychain-password");
  assert.deepEqual(f.calls[setIdx], ["set-keychain-password", "-o", "", "-p", "M".repeat(64), KC]);
  assert.ok(f.calls.slice(setIdx).some((c) => c[0] === "unlock-keychain" && c[2] === "M".repeat(64)));
});

test("migration: the keychain is not changed when the password cannot be stored", () => {
  const f = fake({ kcPassword: "", storeFails: true });
  ensureAgyKeychain(HOME, f.deps);
  assert.equal(f.kc.password, "");
  assert.ok(!cmds(f).includes("set-keychain-password"));
  assert.ok(f.calls.some((c) => c[0] === "unlock-keychain" && c[2] === ""));
});

test("migration: skipped when the empty password does not unlock (unknown password — never touched)", () => {
  const f = fake({ kcPassword: "user-chosen" });
  ensureAgyKeychain(HOME, f.deps);
  assert.equal(f.kc.password, "user-chosen");
  assert.ok(!cmds(f).includes("set-keychain-password"));
  assert.ok(!cmds(f).includes("create-keychain"));
  assert.equal(f.store.has(SVC), false);
});

test("migration: a failed set-keychain-password keeps the empty password usable", () => {
  const f = fake({ kcPassword: "", setPasswordFails: true });
  ensureAgyKeychain(HOME, f.deps);
  assert.equal(f.kc.password, "");
  // The keychain still ends up unlocked with the old password.
  assert.equal(f.calls.filter((c) => c[0] === "unlock-keychain").at(-1)?.[2], "");
});

test("half-finished migration (stored, keychain still empty) is completed on the next run", () => {
  const f = fake({ kcPassword: "", stored: "H".repeat(64) });
  ensureAgyKeychain(HOME, f.deps);
  assert.equal(f.kc.password, "H".repeat(64));
  assert.ok(f.calls.some((c) => c[0] === "set-keychain-password" && c[2] === "" && c[4] === "H".repeat(64)));
});

test("never throws when a dependency throws", () => {
  const f = fake();
  f.deps.security = () => {
    throw new Error("boom");
  };
  assert.doesNotThrow(() => ensureAgyKeychain(HOME, f.deps));
});

test("off macOS it does nothing", () => {
  const f = fake();
  ensureAgyKeychain(HOME, { ...f.deps, platform: "linux" });
  assert.equal(f.calls.length, 0);
});

test("doctor: warns for profiles whose keychain has no stored password", () => {
  const warn = agyKeychainPasswordCheck([
    { name: "work", state: "empty" },
    { name: "home", state: "protected" },
  ]);
  assert.equal(warn.status, "warn");
  assert.match(warn.detail, /work/);
  assert.doesNotMatch(warn.detail, /home/);
  assert.ok(warn.fix);

  const ok = agyKeychainPasswordCheck([{ name: "home", state: "protected" }, { name: "new", state: "none" }]);
  assert.equal(ok.status, "ok");
});
