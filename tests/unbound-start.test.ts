import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const R = await import("../src/dir-resolve.js");
const U = await import("../src/unbound-ask.js");

const NOW = Date.parse("2026-10-28T12:00:00Z");
const H = 3_600_000;

/** Fresh usage; `lose` is how far into the week the account is (higher reset pressure on `soon`). */
function snap(weekUtil: number, resetInH: number) {
  return {
    windows: [{ key: "seven_day", label: "All", utilization: weekUtil, resetsAt: new Date(NOW + resetInH * H).toISOString() }],
    routines: null,
    capturedAt: new Date(NOW - 60_000).toISOString(),
  };
}

/** star = the preferred account with lots of time left; soon = would lose the most at its reset. */
function plain(over: Partial<Parameters<typeof R.resolveForDir>[0]> = {}) {
  const usage: Record<string, ReturnType<typeof snap>> = { star: snap(0, 144), soon: snap(40, 10), out: snap(0, 144) };
  return R.resolveForDir({
    providerId: "claude",
    mapping: null,
    active: "star",
    names: ["star", "soon", "out"],
    exists: () => true,
    signedIn: (n) => n !== "out",
    pool: () => null,
    usage: (n) => ({ snapshot: usage[n], capturedMs: NOW - 60_000 }),
    now: NOW,
    ...over,
  });
}

test("no strategy: the balanced pick is unchanged and nothing asks", () => {
  const r = plain();
  assert.equal(r.name, "soon");
  assert.equal(r.ask, undefined);
});

test("strategy default: the preferred account takes the start although another would lose more", () => {
  const r = plain({ strategy: "default" });
  assert.equal(r.name, "star");
  assert.ok(r.why.includes("Strategy default — taking the preferred account claude/star"), r.why.join("\n"));
});

test("strategy default: a preferred account that cannot take work, or none at all, balances and says why", () => {
  const out = plain({ strategy: "default", active: "out" });
  assert.equal(out.name, "soon");
  assert.ok(out.why.some((w) => w.startsWith("Strategy default — claude/out cannot take work right now")), out.why.join("\n"));
  const none = plain({ strategy: "default", active: null });
  assert.equal(none.name, "soon");
  assert.ok(none.why.some((w) => w.startsWith("Strategy default — no preferred account")), none.why.join("\n"));
});

test("strategy ask: lists every account that can take work, and falls back to the preferred one", () => {
  const r = plain({ strategy: "ask" });
  assert.deepEqual(r.ask, ["star", "soon"]);
  assert.equal(r.name, "star", "the pick when nobody can be asked");
  assert.ok(r.why.some((w) => w.startsWith("Strategy ask — a start from a terminal asks which of 2 accounts")), r.why.join("\n"));
});

test("strategy ask: one usable account, or a folder rule, decides without asking", () => {
  const single = plain({ strategy: "ask", signedIn: (n) => n === "star" });
  assert.equal(single.ask, undefined);
  assert.equal(single.name, "star");
  const ruled = plain({ strategy: "ask", mapping: { path: "/w", name: "soon" } });
  assert.equal(ruled.ask, undefined);
  assert.equal(ruled.name, "soon");
});

test("parseChoice: Enter keeps the suggestion; a number or a name picks; anything else is no choice", () => {
  const choices = ["star", "soon"];
  assert.equal(U.parseChoice("", choices, "star"), "star");
  assert.equal(U.parseChoice("  2 ", choices, "star"), "soon");
  assert.equal(U.parseChoice("soon", choices, "star"), "soon");
  assert.equal(U.parseChoice("3", choices, "star"), null);
  assert.equal(U.parseChoice("0", choices, "star"), null);
  assert.equal(U.parseChoice("other", choices, "star"), null);
  assert.equal(U.parseChoice("", choices, null), null);
});

test("canAsk: only with a terminal on both stdin and stderr", () => {
  assert.equal(U.canAsk({ stdin: true, stderr: true }), true);
  assert.equal(U.canAsk({ stdin: false, stderr: true }), false);
  assert.equal(U.canAsk({ stdin: true, stderr: false }), false);
});

test("askLines: numbered choices with the suggestion marked", () => {
  const lines = U.askLines("claude", ["star", "soon"], "star");
  assert.equal(lines[0], "agent-switch: which claude account should this start use?");
  assert.equal(lines[1], "  1) star  (Enter)");
  assert.equal(lines[2], "  2) soon");
});

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist/index.js");
const gate = { skip: fs.existsSync(CLI) ? false : "run `npm run build` first (dist/index.js missing)" };

test("CLI: `strategy ask` never prompts off a terminal — `dir --guard` takes the preferred account; `dir --json` lists the choices", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-ask-"));
  try {
    for (const n of ["star", "soon"]) {
      const cfg = path.join(home, "claude", n, "config");
      fs.mkdirSync(cfg, { recursive: true });
      fs.writeFileSync(path.join(cfg, ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: `${n}@example.com` } }));
    }
    const env = { ...process.env, AGENT_SWITCH_HOME: home };
    execFileSync("node", [CLI, "use", "star"], { env });
    assert.match(execFileSync("node", [CLI, "strategy", "ask"], { env, encoding: "utf8" }), /^claude: ask/);
    const guarded = spawnSync("node", [CLI, "dir", "--guard"], { env, encoding: "utf8", input: "2\n" });
    assert.equal(guarded.status, 0);
    assert.equal(guarded.stdout.trim(), path.join(home, "claude", "star", "config"), "piped input is not an answer");
    assert.doesNotMatch(guarded.stderr, /which claude account/);
    const json = JSON.parse(execFileSync("node", [CLI, "dir", "--json"], { env, encoding: "utf8" }));
    assert.deepEqual(json.ask, ["star", "soon"]);
    assert.equal(json.profile, "claude/star");
    execFileSync("node", [CLI, "strategy", "default"], { env });
    assert.equal(JSON.parse(execFileSync("node", [CLI, "strategy", "--json"], { env, encoding: "utf8" })).strategy, "default");
    assert.notEqual(spawnSync("node", [CLI, "strategy", "sometimes"], { env }).status, 0);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
