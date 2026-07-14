import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// End-to-end smokes over the BUILT CLI (`dist/index.js`) — the layer the round-2
// blocker (F1) lived in, previously untested. Requires `npm run build` first
// (CI runs it); skips cleanly otherwise so a bare `npm test` never false-fails.
const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist/index.js");
const gate = { skip: fs.existsSync(CLI) ? false : "run `npm run build` first (dist/index.js missing)" };

function run(home: string, args: string[]): string {
  return execFileSync("node", [CLI, ...args], {
    env: { ...process.env, AGENT_SWITCH_HOME: home },
    encoding: "utf8",
  });
}

function seed(home: string, provider: string, name: string): void {
  const dir = path.join(home, provider, name, "config");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, provider === "claude" ? ".claude.json" : "auth.json"), "{}");
}

test("flag-first `remove --provider codex opfer` removes opfer, NOT codex (F1 repro)", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  try {
    seed(home, "codex", "codex"); // the wrong target the bug used to hit
    seed(home, "codex", "opfer"); // the intended target
    run(home, ["remove", "--provider", "codex", "opfer", "--force"]);
    assert.equal(fs.existsSync(path.join(home, "codex", "opfer")), false); // intended one gone
    assert.equal(fs.existsSync(path.join(home, "codex", "codex")), true); // bystander survived
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("flag-first `use --provider codex work` activates the right profile", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  try {
    seed(home, "codex", "work");
    run(home, ["use", "--provider", "codex", "work"]);
    const state = JSON.parse(fs.readFileSync(path.join(home, "state.json"), "utf8"));
    assert.equal(state.active.codex, "work");
    assert.equal(state.active.claude, null); // did not touch the wrong provider
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("`apps --json` lists the registered claude-desktop app", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  try {
    const apps = JSON.parse(run(home, ["apps", "--json"]));
    const cd = apps.find((a: any) => a.id === "claude-desktop");
    assert.ok(cd, "claude-desktop should be listed");
    assert.equal(cd.provider, "claude");
    assert.equal(cd.strategy, "user-data-dir");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// Never runs a real launch: unknown-app + missing-profile both error BEFORE the
// isInstalled/spawn step, so the app is never opened by the test.
test("`open` errors before launching: usage, unknown app, and missing profile", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  try {
    assert.throws(() => run(home, ["open"]), /usage: agent-switch open/i);
    assert.throws(() => run(home, ["open", "no-such-app"]), /unknown app/i);
    // registered app but nothing to launch → errors before any launch. The exact
    // reason is platform-dependent: non-macOS hits the "macOS-only" guard first;
    // on macOS it reaches "no profile given". Either proves no launch happened.
    assert.throws(() => run(home, ["open", "claude-desktop"]), /mac.?os-only|no profile given and none active/i);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("`label` tags a profile and surfaces it in `list --json`", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  try {
    seed(home, "claude", "work");
    run(home, ["label", "work", "Work"]);
    const rows = JSON.parse(run(home, ["list", "--json"]));
    assert.equal(rows.find((r: any) => r.name === "work").label, "Work");
    run(home, ["label", "work", "none"]); // clear
    const cleared = JSON.parse(run(home, ["list", "--json"]));
    assert.equal(cleared.find((r: any) => r.name === "work").label, null);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("`autoswitch on --threshold` persists and defaults OFF", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  try {
    assert.match(run(home, ["autoswitch", "status"]), /claude: auto-switch OFF/);
    run(home, ["autoswitch", "on", "--threshold", "88"]); // defaults to claude
    const state = JSON.parse(fs.readFileSync(path.join(home, "state.json"), "utf8"));
    assert.equal(state.autoSwitch.claude.enabled, true);
    assert.equal(state.autoSwitch.claude.threshold, 88); // value did not leak to a positional
    assert.equal(state.autoSwitch.codex.enabled, false); // per-provider: codex untouched
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("`uninstall --force` removes all agent-switch data", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  try {
    seed(home, "claude", "work");
    seed(home, "codex", "oai");
    assert.equal(fs.existsSync(home), true);
    run(home, ["uninstall", "--force"]);
    assert.equal(fs.existsSync(home), false); // ROOT gone
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("`uninstall` without --force does not delete anything", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  try {
    seed(home, "claude", "work");
    const out = run(home, ["uninstall"]);
    assert.match(out, /--force/);
    assert.equal(fs.existsSync(path.join(home, "claude", "work")), true); // untouched
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("`deactivate --provider codex` clears only that provider's active profile", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  try {
    seed(home, "codex", "work");
    seed(home, "claude", "main");
    run(home, ["use", "--provider", "codex", "work"]);
    run(home, ["use", "main"]); // claude active
    run(home, ["deactivate", "--provider", "codex"]);
    const state = JSON.parse(fs.readFileSync(path.join(home, "state.json"), "utf8"));
    assert.equal(state.active.codex, null); // cleared
    assert.equal(state.active.claude, "main"); // untouched
    assert.equal(fs.existsSync(path.join(home, "codex", "work")), true); // profile itself kept
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("first `dir` after a v1→v2 upgrade migrates and prints only the clean config path (N1)", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  try {
    // v1 flat layout + v1 state, active profile, no v2 marker yet.
    fs.mkdirSync(path.join(home, "legacy", "config"), { recursive: true });
    fs.writeFileSync(path.join(home, "legacy", "config", ".claude.json"), "{}");
    fs.writeFileSync(path.join(home, "state.json"), JSON.stringify({ active: "legacy" }));

    // The shell wrapper captures STDOUT only (`dir="$(agent-switch dir 2>/dev/null)"`).
    const out = execFileSync("node", [CLI, "dir"], {
      env: { ...process.env, AGENT_SWITCH_HOME: home },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"], // drop stderr, like the wrapper
    }).trim();

    // `dir` must have triggered migration and returned exactly the migrated path
    // — one line, no status noise (that goes to stderr).
    assert.equal(out, path.join(home, "claude", "legacy", "config"));
    assert.equal(fs.existsSync(path.join(home, "claude", "legacy", "config")), true);
    assert.ok(!out.includes("Migrated"));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("`list --json` emits the profile list as valid JSON (GUI contract)", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  try {
    seed(home, "claude", "work");
    const rows = JSON.parse(run(home, ["list", "--json"]));
    assert.equal(Array.isArray(rows), true);
    assert.equal(rows[0].provider, "claude");
    assert.equal(rows[0].name, "work");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
