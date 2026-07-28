import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { serviceNameFor } from "../src/keychain.js";

/**
 * LOCAL-ONLY end-to-end tests for the live account switch (`rebind`) — the flow
 * the GUI's "Switch account" button and the CLI limit dialog drive. Run with
 * `task test:switch`.
 *
 * These exercise the REAL stack the unit fakes cannot reach: the built CLI
 * (dist/index.js) as a subprocess, the real macOS Keychain (`security`), the
 * real lock dirs, and the real state.json breaker persistence across processes.
 * Every profile lives in a throw-away AGENT_SWITCH_HOME, so Keychain service
 * names ("Claude Code-credentials-" + sha256(configDir)[:8]) are unique per
 * test and can never collide with real profiles or the default Claude install.
 * All entries are deleted again in `after()`.
 *
 * Deliberately NOT run in CI: gated behind AGENT_SWITCH_SWITCH_TESTS=1 (plus
 * macOS + a prior `npm run build`), because CI runners have no usable Keychain
 * and these tests intentionally hit the real credential store.
 */

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist/index.js");
const ENABLED = process.env.AGENT_SWITCH_SWITCH_TESTS === "1";
const gate = {
  skip: !ENABLED
    ? "local-only: run via `task test:switch` (sets AGENT_SWITCH_SWITCH_TESTS=1)"
    : process.platform !== "darwin"
      ? "macOS only (rebind is keychain-based)"
      : !fs.existsSync(CLI)
        ? "run `npm run build` first (dist/index.js missing)"
        : false,
};

// Every Keychain service this run touches, torn down in after() (belt +
// braces — rebind/restore already delete/move entries as part of the flow).
const createdServices = new Set<string>();
const createdHomes: string[] = [];

after(() => {
  for (const svc of createdServices) {
    try {
      execFileSync("security", ["delete-generic-password", "-a", os.userInfo().username, "-s", svc], { stdio: "ignore" });
    } catch {
      /* already gone — rebind moved or deleted it */
    }
  }
  for (const home of createdHomes) fs.rmSync(home, { recursive: true, force: true });
});

function mkHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-switch-e2e-"));
  createdHomes.push(home);
  return home;
}

function cfgDir(home: string, name: string): string {
  return path.join(home, "claude", name, "config");
}

/** A realistic Claude credential: distinct stable account id, far-future expiry. */
function cred(account: string, token: string): string {
  return JSON.stringify({
    claudeAiOauth: {
      accessToken: token,
      refreshToken: "rt-" + token,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      accountUuid: "acct-" + account,
      scopes: ["user:inference"],
      subscriptionType: "max",
    },
  });
}

function kcGet(service: string): string | null {
  try {
    return execFileSync("security", ["find-generic-password", "-a", os.userInfo().username, "-w", "-s", service], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).replace(/\n$/, "");
  } catch {
    return null;
  }
}

function kcAdd(service: string, value: string): void {
  createdServices.add(service);
  execFileSync("security", ["add-generic-password", "-U", "-a", os.userInfo().username, "-s", service, "-w", value], {
    stdio: "ignore",
  });
}

/** Seed a logged-in profile; credential in the Keychain (production shape) or the plaintext file. */
function seed(home: string, name: string, opts: { store?: "keychain" | "file" } = {}): { svc: string; config: string } {
  const config = cfgDir(home, name);
  fs.mkdirSync(config, { recursive: true });
  const svc = serviceNameFor(config);
  createdServices.add(svc); // rebind may write here even when we seed the file
  if ((opts.store ?? "keychain") === "keychain") {
    kcAdd(svc, cred(name, "tok-" + name));
  } else {
    fs.writeFileSync(path.join(config, ".credentials.json"), cred(name, "tok-" + name), { mode: 0o600 });
  }
  return { svc, config };
}

function run(home: string, args: string[]): string {
  return execFileSync("node", [CLI, ...args], {
    env: { ...process.env, AGENT_SWITCH_HOME: home },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Run the CLI expecting a non-zero exit; returns stderr for message asserts. */
function runFail(home: string, args: string[]): string {
  try {
    run(home, args);
  } catch (e: any) {
    assert.notEqual(e.status, 0, "expected a non-zero exit");
    return String(e.stderr ?? "");
  }
  assert.fail(`expected \`agent-switch ${args.join(" ")}\` to fail, but it exited 0`);
}

function tokenIn(raw: string | null): string | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw)?.claudeAiOauth?.accessToken ?? null;
  } catch {
    return null;
  }
}

function breakerState(home: string): { disabled: boolean; consecutiveFailures: number } {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(home, "state.json"), "utf8"));
    return { disabled: s?.rebind?.disabled === true, consecutiveFailures: s?.rebind?.consecutiveFailures ?? 0 };
  } catch {
    return { disabled: false, consecutiveFailures: 0 };
  }
}

function forceBreaker(home: string, next: { disabled: boolean; consecutiveFailures: number }): void {
  const file = path.join(home, "state.json");
  const s = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  s.rebind = next;
  fs.writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
}

function marker(home: string, name: string): any | null {
  const file = path.join(cfgDir(home, name), ".agent-switch-rebind.json");
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
}

// ---------------------------------------------------------------------------

test("switch A→B: the full credential swap over the real CLI + real Keychain", gate, () => {
  const home = mkHome();
  const A = seed(home, "A");
  const B = seed(home, "B");

  const out = run(home, ["rebind", "B", "--profile", "A"]);
  assert.match(out, /Rebound "A" → "B"/);

  assert.equal(tokenIn(kcGet(A.svc)), "tok-B", "A's live store now serves B's account");
  assert.equal(kcGet(B.svc), null, "B's Keychain entry emptied — the family lives in exactly one store");

  const m = marker(home, "A");
  assert.ok(m, "binding marker written");
  assert.equal(m.boundToProfile, "B");
  assert.equal(tokenIn(m.runningOwnCredential), "tok-A", "A's own credential stashed for restore");
  assert.equal(tokenIn(m.targetOrigCredential), "tok-B", "B's original credential stashed for restore");

  const reg = JSON.parse(fs.readFileSync(path.join(home, ".agent-switch-rebind-registry.json"), "utf8"));
  assert.equal(reg.B?.runningProfile, "A", "global registry records the binding");
});

test("restore puts both profiles back on their own accounts", gate, () => {
  const home = mkHome();
  const A = seed(home, "A");
  const B = seed(home, "B");

  run(home, ["rebind", "B", "--profile", "A"]);
  const out = run(home, ["rebind", "--restore", "--profile", "A"]);
  assert.match(out, /Restored "A"/);

  assert.equal(tokenIn(kcGet(A.svc)), "tok-A", "A back on its own account");
  assert.equal(tokenIn(kcGet(B.svc)), "tok-B", "B's store restored");
  assert.equal(marker(home, "A"), null, "marker cleared");
  const reg = JSON.parse(fs.readFileSync(path.join(home, ".agent-switch-rebind-registry.json"), "utf8"));
  assert.equal(reg.B, undefined, "registry entry released");
});

test("repeated switching A→B, A→C, A→B just works — no 'already rebound', no breaker trip", gate, () => {
  const home = mkHome();
  const A = seed(home, "A");
  const B = seed(home, "B");
  const C = seed(home, "C");

  // The exact user journey that used to dead-end: switch, then switch again
  // (the GUI's "Switch account" button) — previously every second switch died
  // with "already rebound" and three tries tripped the circuit-breaker.
  run(home, ["rebind", "B", "--profile", "A"]);
  run(home, ["rebind", "C", "--profile", "A"]);
  assert.equal(tokenIn(kcGet(A.svc)), "tok-C", "A now serves C");
  assert.equal(tokenIn(kcGet(B.svc)), "tok-B", "B restored on the way through");

  run(home, ["rebind", "B", "--profile", "A"]);
  assert.equal(tokenIn(kcGet(A.svc)), "tok-B", "A serves B again");
  assert.equal(tokenIn(kcGet(C.svc)), "tok-C", "C restored on the way through");
  assert.equal(marker(home, "A").boundToProfile, "B", "marker tracks the latest binding");

  assert.deepEqual(breakerState(home), { disabled: false, consecutiveFailures: 0 }, "three switches, breaker untouched");

  // And the way back to A's own account still works.
  run(home, ["rebind", "--restore", "--profile", "A"]);
  assert.equal(tokenIn(kcGet(A.svc)), "tok-A");
  assert.equal(tokenIn(kcGet(B.svc)), "tok-B");
});

test("refusals (target not logged in) never disable switching", gate, () => {
  const home = mkHome();
  seed(home, "A");
  const B = seed(home, "B");
  // D exists as a profile but has NO credential anywhere → every attempt refuses.
  fs.mkdirSync(cfgDir(home, "D"), { recursive: true });

  for (let i = 0; i < 3; i++) {
    const err = runFail(home, ["rebind", "D", "--profile", "A"]);
    assert.match(err, /no readable credential/);
    assert.doesNotMatch(err, /Circuit-breaker/i, "a refusal must not read like a breaker failure");
  }
  assert.deepEqual(breakerState(home), { disabled: false, consecutiveFailures: 0 }, "three refusals, breaker untouched");

  // Switching to a valid target right afterwards works — rebind was never disabled.
  run(home, ["rebind", "B", "--profile", "A"]);
  assert.equal(tokenIn(kcGet(serviceNameFor(cfgDir(home, "A")))), "tok-B");
  assert.equal(kcGet(B.svc), null);
});

test("recovery from the stuck state: tripped breaker + active binding → --reset → switching works in ONE step", gate, () => {
  const home = mkHome();
  const A = seed(home, "A");
  seed(home, "B");
  const C = seed(home, "C");

  // Reproduce the reported stuck state: A is rebound to B AND the breaker is
  // tripped (state.json says disabled) — the exact situation the error
  // "already rebound … Circuit-breaker tripped … rebind is now DISABLED" left
  // the user in.
  run(home, ["rebind", "B", "--profile", "A"]);
  forceBreaker(home, { disabled: true, consecutiveFailures: 3 });

  const err = runFail(home, ["rebind", "C", "--profile", "A"]);
  assert.match(err, /disabled/, "a tripped breaker refuses up-front");
  assert.match(err, /rebind --reset/, "…and names the recovery command");

  const out = run(home, ["rebind", "--reset"]);
  assert.match(out, /re-enabled/);

  // ONE switch command must now succeed despite the still-active old binding
  // (re-switch restores it internally first — no manual --restore required).
  run(home, ["rebind", "C", "--profile", "A"]);
  assert.equal(tokenIn(kcGet(A.svc)), "tok-C", "A serves C after recovery");
  assert.equal(tokenIn(kcGet(serviceNameFor(cfgDir(home, "B")))), "tok-B", "B restored by the re-switch");
  assert.equal(kcGet(C.svc), null, "C's own store emptied into the binding");
  assert.deepEqual(breakerState(home), { disabled: false, consecutiveFailures: 0 });
});

test("restore keeps working while rebind is disabled (recovery path is exempt)", gate, () => {
  const home = mkHome();
  const A = seed(home, "A");
  const B = seed(home, "B");

  run(home, ["rebind", "B", "--profile", "A"]);
  forceBreaker(home, { disabled: true, consecutiveFailures: 3 });

  const out = run(home, ["rebind", "--restore", "--profile", "A"]);
  assert.match(out, /Restored "A"/);
  assert.equal(tokenIn(kcGet(A.svc)), "tok-A");
  assert.equal(tokenIn(kcGet(B.svc)), "tok-B");
});

test("`rebind <account>` without --profile switches the ACTIVE profile (the GUI/CLI default)", gate, () => {
  const home = mkHome();
  const A = seed(home, "A");
  seed(home, "B");

  run(home, ["use", "A"]);
  run(home, ["rebind", "B"]);
  assert.equal(tokenIn(kcGet(A.svc)), "tok-B", "active profile A now serves B");
  assert.equal(marker(home, "A").boundToProfile, "B");
});

test("file-only profiles (plaintext .credentials.json, no Keychain entry) switch too", gate, () => {
  const home = mkHome();
  const A = seed(home, "A");
  const B = seed(home, "B", { store: "file" });

  run(home, ["rebind", "B", "--profile", "A"]);
  assert.equal(tokenIn(kcGet(A.svc)), "tok-B", "B's file credential moved into A's Keychain store");
  const lent = path.join(B.config, ".credentials.json.rebind-lent");
  assert.ok(fs.existsSync(lent), "B's plaintext file moved aside (reversible), not deleted");
  assert.ok(!fs.existsSync(path.join(B.config, ".credentials.json")), "B's live file emptied — one live store");

  run(home, ["rebind", "--restore", "--profile", "A"]);
  assert.equal(tokenIn(kcGet(A.svc)), "tok-A");
  assert.ok(fs.existsSync(path.join(B.config, ".credentials.json")), "B's plaintext file returned on restore");
});

test("switching to the account the profile already runs refuses cleanly and stays enabled", gate, () => {
  const home = mkHome();
  const config = cfgDir(home, "A");
  fs.mkdirSync(config, { recursive: true });
  kcAdd(serviceNameFor(config), cred("shared", "tok-shared"));
  const bConfig = cfgDir(home, "B");
  fs.mkdirSync(bConfig, { recursive: true });
  kcAdd(serviceNameFor(bConfig), cred("shared", "tok-shared"));

  const err = runFail(home, ["rebind", "B", "--profile", "A"]);
  assert.match(err, /already running/);
  assert.deepEqual(breakerState(home), { disabled: false, consecutiveFailures: 0 });
});
