import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
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

test("`takeover --in-place` refuses combos that break its contract (before any file op)", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  try {
    seed(home, "claude", "work");
    assert.throws(() => run(home, ["takeover", "sess-1", "--to", "work", "--in-place", "--print-only"]), /--in-place cannot be combined/i);
    assert.throws(() => run(home, ["takeover", "sess-1", "--to", "work", "--in-place", "--keep-source"]), /--in-place cannot be combined/i);
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
    assert.match(run(home, ["autoswitch", "status"]), /claude: near-limit notifications OFF/);
    run(home, ["autoswitch", "on", "--threshold", "88"]); // defaults to claude
    const state = JSON.parse(fs.readFileSync(path.join(home, "state.json"), "utf8"));
    assert.equal(state.autoSwitch.claude.enabled, true);
    assert.equal(state.autoSwitch.claude.threshold, 88); // value did not leak to a positional
    assert.equal(state.autoSwitch.codex.enabled, false); // per-provider: codex untouched
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("`autoswitch on --tag work` persists the tag scope and surfaces it in status --json", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  try {
    run(home, ["autoswitch", "on", "--threshold", "90", "--tag", "work"]); // case-insensitive → "Work"
    const state = JSON.parse(fs.readFileSync(path.join(home, "state.json"), "utf8"));
    assert.equal(state.autoSwitch.claude.enabled, true);
    assert.equal(state.autoSwitch.claude.threshold, 90);
    assert.equal(state.autoSwitch.claude.tag, "Work"); // normalized to the canonical label
    const status = JSON.parse(run(home, ["autoswitch", "status", "--json"]));
    assert.equal(status.claude.tag, "Work");
    // clearing back to all
    run(home, ["autoswitch", "on", "--tag", "all"]);
    assert.equal(JSON.parse(run(home, ["autoswitch", "status", "--json"])).claude.tag, "all");
    // an invalid tag is rejected, not silently accepted
    assert.throws(() => run(home, ["autoswitch", "on", "--tag", "nope"]), /--tag must be one of/i);
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

// ---------- sessions + takeover (road-to-session-handoff, Phases 1-2) --------
// All file mechanics on seeded fakes; the real `claude --resume` semantics are
// contract-gated. `--print-only` keeps every test launch-free, and execFileSync
// has no TTY stdin, so the exec-into-session branch can never fire here.

function seedTranscript(home: string, profile: string, encDir: string, id: string): string {
  const dir = path.join(home, "claude", profile, "config", "projects", encDir);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}.jsonl`);
  fs.writeFileSync(file, `${JSON.stringify({ cwd: "/tmp/proj", summary: "seeded" })}\n{"opaque":1}\n`);
  return file;
}

test("`sessions --json` lists seeded transcripts with metadata only (GUI contract)", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  try {
    seed(home, "claude", "work");
    seedTranscript(home, "work", "-tmp-proj", "0000-e2e-id");
    const rows = JSON.parse(run(home, ["sessions", "--json"]));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].provider, "claude");
    assert.equal(rows[0].profile, "work");
    assert.equal(rows[0].sessionId, "0000-e2e-id");
    assert.equal(rows[0].cwd, "/tmp/proj");
    assert.equal(rows[0].live, false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("`sessions preview --json` returns bounded conversation turns for a claude session (ADR-002)", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  try {
    seed(home, "claude", "work");
    const id = "00000000-0000-4000-8000-000000000001";
    const dir = path.join(home, "claude", "work", "config", "projects", "-tmp-proj");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `${id}.jsonl`),
      [
        JSON.stringify({ cwd: "/tmp/proj", summary: "seeded" }),
        JSON.stringify({ type: "user", message: { role: "user", content: "hello there" } }),
        JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "hi back" }] } }),
      ].join("\n") + "\n",
    );
    const out = JSON.parse(run(home, ["sessions", "preview", id, "--from", "work"]));
    assert.equal(out.provider, "claude");
    assert.equal(out.profile, "work");
    assert.deepEqual(out.messages, [
      { role: "user", text: "hello there" },
      { role: "assistant", text: "hi back" },
    ]);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("`sessions preview` degrades to an empty preview for an unknown id and for codex", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  try {
    seed(home, "claude", "work");
    seed(home, "codex", "oai");
    const id = "00000000-0000-4000-8000-000000000002";
    const unknown = JSON.parse(run(home, ["sessions", "preview", id, "--from", "work"]));
    assert.deepEqual(unknown.messages, []); // unknown id → empty, never an error
    const codex = JSON.parse(run(home, ["sessions", "preview", id, "--provider", "codex", "--from", "oai"]));
    assert.deepEqual(codex.messages, []); // codex deferred (ADR-002)
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("`takeover --print-only` moves the transcript between profiles and prints the resume command", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  try {
    seed(home, "claude", "privat");
    seed(home, "claude", "work");
    const src = seedTranscript(home, "privat", "-tmp-proj", "0000-move-id");
    const out = run(home, ["takeover", "0000-move-id", "--to", "work", "--print-only"]);
    assert.match(out, /run work -- --resume 0000-move-id/);
    assert.equal(fs.existsSync(src), false); // moved out of the source...
    assert.equal(
      fs.existsSync(path.join(home, "claude", "work", "config", "projects", "-tmp-proj", "0000-move-id.jsonl")),
      true, // ...into the same encoded dir on the target
    );
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("`takeover` refuses a target collision and a multi-profile hit (divergence guards)", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  try {
    seed(home, "claude", "privat");
    seed(home, "claude", "work");
    seedTranscript(home, "privat", "-tmp-proj", "0000-dup-id");
    seedTranscript(home, "work", "-tmp-proj", "0000-dup-id");
    // Without --from: the same id in two profiles is surfaced, never guessed.
    assert.throws(() => run(home, ["takeover", "0000-dup-id", "--to", "work", "--print-only"]), /MULTIPLE profiles/);
    // With --from: the transfer hits the collision refusal; both copies survive.
    assert.throws(
      () => run(home, ["takeover", "0000-dup-id", "--from", "privat", "--to", "work", "--print-only"]),
      /refusing to overwrite/,
    );
    assert.equal(fs.existsSync(path.join(home, "claude", "privat", "config", "projects", "-tmp-proj", "0000-dup-id.jsonl")), true);
    assert.equal(fs.existsSync(path.join(home, "claude", "work", "config", "projects", "-tmp-proj", "0000-dup-id.jsonl")), true);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("`takeover` refuses when the source profile has live sessions; `--force` overrides", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  try {
    seed(home, "claude", "privat");
    seed(home, "claude", "work");
    seedTranscript(home, "privat", "-tmp-proj", "0000-live-id");
    // A live-session pid file for THIS test process — alive by definition.
    const sess = path.join(home, "claude", "privat", "config", "sessions");
    fs.mkdirSync(sess, { recursive: true });
    fs.writeFileSync(path.join(sess, `${process.pid}.json`), "{}");

    assert.throws(() => run(home, ["takeover", "0000-live-id", "--to", "work", "--print-only"]), /live Claude sessions/);
    run(home, ["takeover", "0000-live-id", "--to", "work", "--print-only", "--force"]);
    assert.equal(
      fs.existsSync(path.join(home, "claude", "work", "config", "projects", "-tmp-proj", "0000-live-id.jsonl")),
      true,
    );
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("`takeover --keep-source` refuses non-interactive runs (fork cleanup needs the TTY step)", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  try {
    seed(home, "claude", "privat");
    seed(home, "claude", "work");
    seedTranscript(home, "privat", "-tmp-proj", "0000-fork-id");
    assert.throws(
      () => run(home, ["takeover", "0000-fork-id", "--to", "work", "--keep-source", "--print-only"]),
      /interactive terminal/,
    );
    // Nothing moved by the refusal.
    assert.equal(fs.existsSync(path.join(home, "claude", "privat", "config", "projects", "-tmp-proj", "0000-fork-id.jsonl")), true);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("`takeover` on a shared history tree does no file ops, prints the resume command", { skip: process.platform === "win32" ? "POSIX symlinks" : gate.skip }, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  try {
    seed(home, "claude", "privat");
    seed(home, "claude", "work");
    const src = seedTranscript(home, "privat", "-tmp-proj", "0000-shared-id");
    // Simulate `share on --history`: the target's projects/ links to the source's.
    fs.symlinkSync(
      path.join(home, "claude", "privat", "config", "projects"),
      path.join(home, "claude", "work", "config", "projects"),
      "dir",
    );
    const out = run(home, ["takeover", "0000-shared-id", "--to", "work", "--print-only", "--from", "privat"]);
    assert.match(out, /share one history tree/);
    assert.match(out, /run work -- --resume 0000-shared-id/);
    assert.equal(fs.existsSync(src), true); // untouched
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

// ---------- Codex parity (road-to-session-handoff, Phase 5; g03 outcome a) ---
// Codex sessions are date-partitioned rollout files. Same launch-free approach:
// --print-only / --json keep every test off a real `codex` invocation.

const CODEX_UUID = "00000000-0000-4000-8000-000000000abc";

function seedCodexRollout(home: string, profile: string, id: string): string {
  const dir = path.join(home, "codex", profile, "config", "sessions", "2026", "07", "14");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `rollout-2026-07-14T02-00-00-${id}.jsonl`);
  fs.writeFileSync(file, `${JSON.stringify({ type: "session_meta", id })}\n{"opaque":1}\n`);
  return file;
}

test("`sessions --provider codex --json` lists seeded rollouts (metadata only)", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  try {
    seed(home, "codex", "work");
    seedCodexRollout(home, "work", CODEX_UUID);
    const rows = JSON.parse(run(home, ["sessions", "--provider", "codex", "--json"]));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].provider, "codex");
    assert.equal(rows[0].profile, "work");
    assert.equal(rows[0].sessionId, CODEX_UUID);
    assert.equal(rows[0].cwd, null); // rollout blob never read
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("`takeover --provider codex --print-only` moves the rollout and prints the codex resume command", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  try {
    seed(home, "codex", "privat");
    seed(home, "codex", "work");
    const src = seedCodexRollout(home, "privat", CODEX_UUID);
    const out = run(home, ["takeover", CODEX_UUID, "--to", "work", "--provider", "codex", "--print-only"]);
    assert.match(out, new RegExp(`run work --provider codex -- resume ${CODEX_UUID}`));
    assert.equal(fs.existsSync(src), false); // moved out of the source...
    assert.equal(
      fs.existsSync(path.join(home, "codex", "work", "config", "sessions", "2026", "07", "14", `rollout-2026-07-14T02-00-00-${CODEX_UUID}.jsonl`)),
      true, // ...into the same date partition on the target
    );
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("`takeover --provider codex --keep-source` is refused (fork unverified → move-only)", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  try {
    seed(home, "codex", "privat");
    seed(home, "codex", "work");
    const src = seedCodexRollout(home, "privat", CODEX_UUID);
    assert.throws(
      () => run(home, ["takeover", CODEX_UUID, "--to", "work", "--provider", "codex", "--keep-source", "--print-only"]),
      /keep-source is not supported for codex/i,
    );
    assert.equal(fs.existsSync(src), true); // refused before any file op
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});


test("`notify --kind/--title/--message` records the event and reads back (GUI notification path — F: value-flags)", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  try {
    const created = JSON.parse(
      run(home, ["notify", "--kind", "success", "--title", "Auto-switched account", "--message", "a → b (dev test).", "--json"]),
    );
    assert.equal(created.kind, "success"); // --kind value was consumed, not dropped
    assert.equal(created.title, "Auto-switched account"); // --title value survived
    assert.equal(created.message, "a → b (dev test)."); // --message value survived
    const list = JSON.parse(run(home, ["notifications", "--json"]));
    assert.equal(list.length, 1);
    assert.equal(list[0].title, "Auto-switched account");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("`providers disable --surface cli` toggles only that surface (value-flag regression)", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  try {
    run(home, ["providers", "disable", "--provider", "claude", "--surface", "cli"]);
    const status = JSON.parse(run(home, ["providers", "status", "--json"]));
    assert.equal(status.claude.cli, false); // the targeted surface went off
    assert.equal(status.claude.ui, true); // the other surface is untouched
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("`label` tags a not-yet-created profile and it survives creation (new-profile tag regression)", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  try {
    // The GUI sets the tag BEFORE `add` creates the profile. Labeling a profile
    // that does not exist yet must succeed (not error) and persist.
    run(home, ["label", "work", "Work", "--provider", "codex"]);
    const state = JSON.parse(fs.readFileSync(path.join(home, "state.json"), "utf8"));
    assert.equal(state.labels["codex/work"], "Work"); // persisted up front
    // Once the profile exists, the pre-set tag surfaces in `list --json`.
    seed(home, "codex", "work");
    const rows = JSON.parse(run(home, ["list", "--provider", "codex", "--json"]));
    assert.equal(rows.find((r: any) => r.name === "work").label, "Work");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("`list --json` lists an antigravity profile even when only its UI surface is on (not-shown regression)", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  try {
    seed(home, "claude", "work");
    // Antigravity's CLI surface OFF but UI ON — a profile still exists on disk.
    // The list used to gate on the CLI surface alone, so the GUI's unfiltered
    // `list --json` dropped the profile and its tab stayed empty. It must now be
    // listed. (Identity is keychain-based on macOS — covered by decodeGoKeyringEmail
    // in providers.test; not seeded here to keep this test keychain-free.)
    fs.writeFileSync(
      path.join(home, "state.json"),
      JSON.stringify({ providers: { antigravity: { cli: false, ui: true } } }),
    );
    fs.mkdirSync(path.join(home, "antigravity", "MatneX", "config"), { recursive: true });

    const rows = JSON.parse(run(home, ["list", "--json"])); // the exact call the GUI makes
    const names = rows.map((r: any) => `${r.provider}/${r.name}`);
    assert.ok(names.includes("antigravity/MatneX"), `antigravity profile missing: ${names.join(", ")}`);
    assert.ok(names.includes("claude/work"), "other profiles still listed");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("`share status --json` reports the real link state (off, then on after `share on`)", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  try {
    seed(home, "claude", "src"); // acts as the --source
    seed(home, "claude", "dst");
    fs.mkdirSync(path.join(home, "claude", "src", "config", "skills"), { recursive: true });
    const off = JSON.parse(run(home, ["share", "status", "--source", "src", "--json"]));
    assert.equal(off.active, false);
    run(home, ["share", "on", "--source", "src"]);
    const on = JSON.parse(run(home, ["share", "status", "--source", "src", "--json"]));
    assert.equal(on.active, true);
    assert.equal(on.profiles.find((p: any) => p.name === "dst").shared, true);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// ---------- sessions rm / restore (Claude; delete wiring + guards) -----------

const SID = "22222222-2222-4222-8222-222222222222";

function seedClaudeSession(home: string, profile: string, enc: string, id: string): string {
  const dir = path.join(home, "claude", profile, "config", "projects", enc);
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `${id}.jsonl`);
  fs.writeFileSync(f, `{"cwd":"/x","type":"m"}\n{"opaque":1}\n`);
  return f;
}

function runFail(home: string, args: string[]): string {
  try {
    execFileSync("node", [CLI, ...args], { env: { ...process.env, AGENT_SWITCH_HOME: home }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return "";
  } catch (e) {
    return String((e as { stderr?: string; stdout?: string }).stderr ?? (e as { stdout?: string }).stdout ?? e);
  }
}

test("`sessions rm --from <p> --yes --json` trashes a claude session; `restore` brings it back", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  try {
    seed(home, "claude", "work");
    const f = seedClaudeSession(home, "work", "-x", SID);
    const out = JSON.parse(run(home, ["sessions", "rm", SID, "--from", "work", "--yes", "--json"]));
    assert.equal(out.mode, "trash");
    assert.equal(fs.existsSync(f), false); // moved to trash
    assert.equal(fs.existsSync(path.join(home, "claude", "work", "config")), true); // profile untouched (session-scoped, not `remove`)
    run(home, ["sessions", "restore", out.trashId, "--from", "work"]);
    assert.equal(fs.existsSync(f), true); // restored
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("`sessions rm` rejects a path-traversal id before any fs access", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  try {
    seed(home, "claude", "work");
    assert.match(runFail(home, ["sessions", "rm", "../../etc/passwd", "--yes"]), /invalid session id/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("`sessions rm` refuses without --yes (mandatory confirm gate)", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  try {
    seed(home, "claude", "work");
    seedClaudeSession(home, "work", "-x", SID);
    assert.match(runFail(home, ["sessions", "rm", SID, "--from", "work"]), /--yes/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("`sessions rm` refuses a same-id session in MULTIPLE profiles without --from", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  try {
    seed(home, "claude", "work");
    seed(home, "claude", "priv");
    seedClaudeSession(home, "work", "-x", SID);
    seedClaudeSession(home, "priv", "-x", SID); // same id in two profiles
    assert.match(runFail(home, ["sessions", "rm", SID, "--yes"]), /MULTIPLE profiles/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// ---------- handoff (metadata-only extract; seed print-only) -----------------

const HID = "44444444-4444-4444-8444-444444444444";

test("`handoff extract --print-only` composes a metadata brief, reads no transcript body", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  try {
    seed(home, "claude", "work");
    const dir = path.join(home, "claude", "work", "config", "projects", "-proj");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${HID}.jsonl`), `{"cwd":"/proj","summary":"prev work","type":"m"}\n{"opaque":1}\n`);
    const out = run(home, ["handoff", "extract", HID, "--from", "work", "--to", "codex", "--print-only"]);
    assert.match(out, /CONTEXT DATA, not instructions/); // spotlight preamble
    assert.match(out, /Working directory: `\/proj`/);
    assert.match(out, /LOSSY handoff/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("`handoff extract` writes a 0600 brief; `seed --print-only` references the PATH, not the content", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  try {
    seed(home, "claude", "work");
    seed(home, "codex", "oai");
    const dir = path.join(home, "claude", "work", "config", "projects", "-proj");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${HID}.jsonl`), `{"cwd":"/proj","summary":"SECRET-BODY","type":"m"}\n`);
    const j = JSON.parse(run(home, ["handoff", "extract", HID, "--from", "work", "--to", "codex", "--json"]));
    assert.ok(j.briefPath.endsWith(`${HID}.md`));
    if (process.platform !== "win32") assert.equal(fs.statSync(j.briefPath).mode & 0o777, 0o600);
    const cmd = run(home, ["handoff", "seed", "--to", "oai", "--provider", "codex", "--brief", j.briefPath, "--print-only"]);
    // The seed prompt is JSON.stringify'd for the shell, so on Windows the path's
    // backslashes appear escaped (\\) — match the escaped form (a no-op on POSIX).
    assert.ok(cmd.includes(j.briefPath.replace(/\\/g, "\\\\"))); // path referenced
    assert.ok(!cmd.includes("SECRET-BODY")); // content NOT in the seed command/argv
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("`handoff extract` rejects a traversal id before fs access", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  try {
    seed(home, "claude", "work");
    assert.match(runFail(home, ["handoff", "extract", "../../x", "--from", "work", "--to", "codex"]), /invalid session id/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// ---------- single-load guard, end to end over the built CLI -----------------
//
// These exercise the real wiring (state → provider → detection → exit code),
// not the pure core. Liveness uses THIS test process's own pid, which is alive
// by construction — the same `process.kill(pid, 0)` probe the CLI uses.

/** Register a live session on a seeded profile, the way Claude Code does. */
function seedLiveSession(home: string, name: string, pid: number): void {
  const dir = path.join(home, "claude", name, "config", "sessions");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${pid}.json`), "{}");
}

/** Run the CLI and capture status + stdout + stderr instead of throwing. */
function runRaw(home: string, args: string[], env: Record<string, string> = {}) {
  const r = spawnSync("node", [CLI, ...args], {
    env: { ...process.env, AGENT_SWITCH_HOME: home, ...env },
    encoding: "utf8",
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

test("guard: `dir --guard` refuses a second load with exit 86, and still prints the path", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-guard-"));
  try {
    seed(home, "claude", "work");
    run(home, ["guard", "block"]); // fresh installs start on warn; this exercises block
    run(home, ["use", "work"]);
    seedLiveSession(home, "work", process.pid);

    const r = runRaw(home, ["dir", "--guard"]);
    assert.equal(r.status, 86, "the wrapper keys on this exact code");
    // stdout stays the contract the wrapper reads — the guard speaks on stderr.
    assert.match(r.stdout.trim(), /claude[/\\]work[/\\]config$/);
    assert.match(r.stderr, /already loaded/);
    assert.match(r.stderr, new RegExp(`pid ${process.pid}`));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("guard: a free profile passes `dir --guard` untouched (exit 0, no noise)", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-guard-"));
  try {
    seed(home, "claude", "work");
    run(home, ["use", "work"]);
    const r = runRaw(home, ["dir", "--guard"]);
    assert.equal(r.status, 0);
    assert.equal(r.stderr.trim(), "");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("guard: a dead pid is not a load — the profile stays startable", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-guard-"));
  try {
    seed(home, "claude", "work");
    run(home, ["use", "work"]);
    // A pid that cannot be alive: a crashed session's leftover file must never
    // lock the user out, which is why there is no lease of our own.
    seedLiveSession(home, "work", 2 ** 31 - 1);
    assert.equal(runRaw(home, ["dir", "--guard"]).status, 0);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("guard: the env override downgrades a refusal to a warning", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-guard-"));
  try {
    seed(home, "claude", "work");
    run(home, ["use", "work"]);
    seedLiveSession(home, "work", process.pid);
    const r = runRaw(home, ["dir", "--guard"], { AGENT_SWITCH_ALLOW_DUPLICATE: "1" });
    assert.equal(r.status, 0);
    assert.match(r.stderr, /continuing anyway/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("guard: a nested start (env already on this profile) is never refused", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-guard-"));
  try {
    seed(home, "claude", "work");
    run(home, ["use", "work"]);
    seedLiveSession(home, "work", process.pid);
    const r = runRaw(home, ["dir", "--guard"], {
      CLAUDE_CONFIG_DIR: path.join(home, "claude", "work", "config"),
    });
    assert.equal(r.status, 0, "a sub-agent of the running session is a child, not a duplicate");
    assert.equal(r.stderr.trim(), "");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("guard: policy off and warn never refuse", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-guard-"));
  try {
    seed(home, "claude", "work");
    run(home, ["use", "work"]);
    seedLiveSession(home, "work", process.pid);

    run(home, ["guard", "warn"]);
    const warned = runRaw(home, ["dir", "--guard"]);
    assert.equal(warned.status, 0);
    assert.match(warned.stderr, /continuing anyway/);

    run(home, ["guard", "off"]);
    const off = runRaw(home, ["dir", "--guard"]);
    assert.equal(off.status, 0);
    assert.equal(off.stderr.trim(), "");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("guard: plain `dir` (no --guard) is byte-for-byte unchanged by the feature", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-guard-"));
  try {
    seed(home, "claude", "work");
    run(home, ["use", "work"]);
    seedLiveSession(home, "work", process.pid);
    const r = runRaw(home, ["dir"]);
    assert.equal(r.status, 0);
    assert.equal(r.stderr.trim(), "");
    assert.match(r.stdout.trim(), /claude[/\\]work[/\\]config$/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("guard: codex has no live-session signal, so it can never be refused", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-guard-"));
  try {
    seed(home, "codex", "work");
    run(home, ["use", "--provider", "codex", "work"]);
    // Even with a Claude-shaped pid file present, codex must not enforce.
    const dir = path.join(home, "codex", "work", "config", "sessions");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${process.pid}.json`), "{}");
    const r = runRaw(home, ["dir", "--provider", "codex", "--guard"]);
    assert.equal(r.status, 0);
    assert.equal(r.stderr.trim(), "");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("guard: `run` refuses before launching, and --force gets through", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-guard-"));
  try {
    seed(home, "claude", "work");
    run(home, ["guard", "block"]); // fresh installs start on warn; this exercises block
    seedLiveSession(home, "work", process.pid);
    const refused = runRaw(home, ["run", "work"]);
    assert.equal(refused.status, 86);
    assert.match(refused.stderr, /already loaded/);
    assert.match(refused.stderr, /--force/, "run CAN take --force, so it must be offered here");

    // With --force it proceeds past the guard; it then fails only because the
    // provider binary is absent in the test env — which is past the gate.
    const forced = runRaw(home, ["run", "work", "--force"]);
    assert.notEqual(forced.status, 86);
    assert.match(forced.stderr, /continuing anyway/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("guard: `use` warns about a busy target but never blocks", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-guard-"));
  try {
    seed(home, "claude", "work");
    seedLiveSession(home, "work", process.pid);
    const r = runRaw(home, ["use", "work"]);
    assert.equal(r.status, 0, "`use` loads nothing — it must never refuse");
    assert.match(r.stdout, /Active claude profile: work/);
    assert.match(r.stderr, /already loaded/);
    // The pointer really was written.
    assert.equal(JSON.parse(fs.readFileSync(path.join(home, "state.json"), "utf8")).active.claude, "work");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("guard: bare `guard` reports the policy and what is loaded right now", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-guard-"));
  try {
    seed(home, "claude", "work");
    run(home, ["guard", "block"]); // fresh installs start on warn; this exercises block
    seedLiveSession(home, "work", process.pid);
    const out = run(home, ["guard"]);
    assert.match(out, /Single-load guard: block/);
    assert.match(out, /claude\/work/);

    const json = JSON.parse(run(home, ["guard", "--json"]));
    assert.equal(json.policy, "block");
    assert.deepEqual(json.loaded, [{ provider: "claude", name: "work", sessions: 1 }]);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("guard: an unknown policy value is refused with the valid choices", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-guard-"));
  try {
    assert.throws(() => run(home, ["guard", "maybe"]), /unknown guard policy/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// ---------- honest foundations (road-to-honest-foundations) ----------

function runFull(home: string, args: string[], cwd?: string) {
  return spawnSync("node", [CLI, ...args], { env: { ...process.env, AGENT_SWITCH_HOME: home }, encoding: "utf8", cwd });
}

const TOKEN = "sk-ant-oat01-" + "Z".repeat(64);
const REFRESH = "sk-ant-ort01-" + "Y".repeat(64);

test("upgrade from a 2.1.0 config: labels, mappings, alerts, autoswitch, guard untouched; zero pools", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  try {
    seed(home, "claude", "work");
    seed(home, "claude", "home");
    const state = {
      active: { claude: "work", codex: null, antigravity: null },
      labels: { "claude/work": "Work" },
      autoSwitch: { claude: { enabled: true, threshold: 90, tag: "Work" }, codex: { enabled: false, threshold: 95, tag: "all" }, antigravity: { enabled: false, threshold: 95, tag: "all" } },
      providers: { claude: { cli: true, ui: true }, codex: { cli: true, ui: true }, antigravity: { cli: false, ui: false } },
      binaryPaths: {},
      osNotifications: false,
      rebind: { disabled: false, consecutiveFailures: 0 },
      guard: "block",
    };
    fs.writeFileSync(path.join(home, "state.json"), JSON.stringify(state, null, 2) + "\n");
    fs.writeFileSync(path.join(home, ".layout-v2"), "2\n");
    const mappings = { schema: 2, mappings: { "/tmp/some-repo": { claude: "work" } } };
    fs.writeFileSync(path.join(home, "mappings.json"), JSON.stringify(mappings));
    const alerts = path.join(home, "telemetry-config.json");
    fs.writeFileSync(alerts, JSON.stringify({ notify: true, contextThresholds: [70] }));

    assert.deepEqual(JSON.parse(run(home, ["pool", "--json"])), []);
    run(home, ["list"]);
    run(home, ["protection", "--json"]);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, "state.json"), "utf8")), state);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, "mappings.json"), "utf8")), mappings);
    assert.deepEqual(JSON.parse(fs.readFileSync(alerts, "utf8")), { notify: true, contextThresholds: [70] });
    assert.equal(JSON.parse(run(home, ["guard", "--json"])).policy, "block");
    assert.equal(fs.existsSync(path.join(home, "pools.json")), false, "no pools file is created by an upgrade");
    const prot = JSON.parse(run(home, ["protection", "--json"]));
    assert.deepEqual(prot.find((r: any) => r.profile === "claude/work"), { profile: "claude/work", enabled: true, thresholdPct: 98 });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("a fresh install starts with the guard on warn", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  try {
    assert.equal(JSON.parse(run(home, ["guard", "--json"])).policy, "warn");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("a 2.1.0 install with profiles but no state.json keeps the guard on block", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  try {
    seed(home, "claude", "work"); // `add` without `use` never wrote state.json
    assert.equal(fs.existsSync(path.join(home, "state.json")), false);
    assert.equal(JSON.parse(run(home, ["guard", "--json"])).policy, "block");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("a fresh install keeps warn after its first profile appears", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  try {
    run(home, ["pool", "create", "Work"]); // the first write creates the root on a fresh install
    seed(home, "claude", "work"); // then a profile arrives without `use`
    assert.equal(JSON.parse(run(home, ["guard", "--json"])).policy, "warn");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("auth-status --json, doctor --json and activity --json never contain a token", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  try {
    const ccfg = path.join(home, "claude", "work", "config");
    fs.mkdirSync(ccfg, { recursive: true });
    fs.writeFileSync(path.join(ccfg, ".claude.json"), "{}");
    fs.writeFileSync(path.join(ccfg, ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: TOKEN, refreshToken: REFRESH, expiresAt: Date.now() + 3600e3 } }));
    const xcfg = path.join(home, "codex", "w", "config");
    fs.mkdirSync(xcfg, { recursive: true });
    fs.writeFileSync(path.join(xcfg, "auth.json"), JSON.stringify({ tokens: { access_token: TOKEN, refresh_token: REFRESH }, last_refresh: "2026-10-27T10:00:00Z" }));

    const auth = run(home, ["auth-status", "--json"]);
    const rows = JSON.parse(auth);
    assert.equal(rows.find((r: any) => r.provider === "codex").state, "connected");
    assert.ok(["connected", "unknown"].includes(rows.find((r: any) => r.provider === "claude").state));

    run(home, ["use", "work"]);
    run(home, ["protection", "set", "claude/work", "--threshold", "95"]);
    const activity = run(home, ["activity", "--json"]);
    const entries = JSON.parse(activity).entries;
    assert.deepEqual(entries.map((e: any) => e.kind), ["switch", "protection"]);

    const doctor = runFull(home, ["doctor", "--json"], undefined);
    const report = JSON.parse(doctor.stdout);
    assert.ok(["ready", "attention", "blocked"].includes(report.readiness));
    for (const c of report.checks) assert.ok(c.id && c.status && typeof c.title === "string");

    for (const out of [auth, activity, doctor.stdout, fs.readFileSync(path.join(home, "activity.jsonl"), "utf8")]) {
      assert.doesNotMatch(out, /ZZZZZZZZ|YYYYYYYY/, "no token value in any output or log");
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("pools: dir --json resolves a pool rule to the freshest member and explains why", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "asw-repo-")));
  try {
    for (const n of ["a", "b"]) {
      const cfg = path.join(home, "claude", n, "config");
      fs.mkdirSync(cfg, { recursive: true });
      fs.writeFileSync(path.join(cfg, ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: `${n}@example.com` } }));
    }
    const sample = (util: number) => ({ samples: [{ at: new Date(Date.now() - 60_000).toISOString(), windows: [{ key: "five_hour", utilization: util }] }] });
    fs.writeFileSync(path.join(home, "claude", "a", "usage-history.json"), JSON.stringify(sample(90)));
    fs.writeFileSync(path.join(home, "claude", "b", "usage-history.json"), JSON.stringify(sample(20)));

    run(home, ["pool", "create", "Work"]);
    run(home, ["pool", "add", "work", "claude/a"]);
    run(home, ["pool", "add", "work", "claude/b"]);
    run(home, ["map", "pool:work", repo]);

    const r = JSON.parse(execFileSync("node", [CLI, "dir", "--json"], { env: { ...process.env, AGENT_SWITCH_HOME: home }, encoding: "utf8", cwd: repo }));
    assert.equal(r.profile, "claude/b");
    assert.match(r.why[0], /^Rule: folder .* → pool work$/);
    assert.match(r.why[r.why.length - 1], /^Picked claude\/b: 80% of its 5h window left, reset time unknown .* · usage checked/);
    const plain = execFileSync("node", [CLI, "dir"], { env: { ...process.env, AGENT_SWITCH_HOME: home }, encoding: "utf8", cwd: repo }).trim();
    assert.equal(plain, path.join(home, "claude", "b", "config"));

    const rules = JSON.parse(run(home, ["mappings", "--json"]));
    assert.deepEqual(rules, [{ path: fs.realpathSync(repo), provider: "claude", target: "pool:work", paused: false }]);
    assert.throws(() => run(home, ["pool", "delete", "work"]), /used by folder rules/);
    const preview = JSON.parse(run(home, ["pool", "suggest", "--json"]));
    assert.equal(preview.preview, true);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("D22: remove off a terminal proceeds with a stderr note; --yes is silent", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  try {
    seed(home, "codex", "a");
    seed(home, "codex", "b");
    const r1 = runFull(home, ["remove", "a", "--provider", "codex"]);
    assert.equal(r1.status, 0);
    assert.match(r1.stderr, /not a terminal — proceeding without confirmation/);
    assert.equal(fs.existsSync(path.join(home, "codex", "a")), false);
    const r2 = runFull(home, ["remove", "b", "--provider", "codex", "--yes"]);
    assert.equal(r2.status, 0);
    assert.equal(r2.stderr, "");
    assert.equal(fs.existsSync(path.join(home, "codex", "b")), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("gui-settings: set/get round-trip; a first-run default never overrides a user off", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  try {
    assert.equal(JSON.parse(run(home, ["gui-settings", "--json"])).autostart.state, "unset");
    run(home, ["gui-settings", "set", "autostart", "disabled", "--by", "user"]);
    run(home, ["gui-settings", "set", "autostart", "enabled", "--by", "first-run"]);
    const s = JSON.parse(run(home, ["gui-settings", "set", "pet-welcomed"]));
    assert.equal(s.autostart.state, "disabled");
    assert.equal(s.petWelcomed, true);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("run --cwd refuses a folder that does not exist, before launching anything", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  try {
    seed(home, "claude", "a");
    assert.throws(() => run(home, ["run", "a", "--cwd", path.join(home, "nope")]), /no such folder/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("remove refuses a profile with an active rebind; --force drops it (stash cleaned)", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  try {
    seed(home, "claude", "p");
    const marker = path.join(home, "claude", "p", "config", ".agent-switch-rebind.json");
    // Stash names that exist in no Keychain: the --force cleanup deletes nothing real.
    fs.writeFileSync(marker, JSON.stringify({ boundToProfile: "a", boundAt: "x", runningOwnStash: "asw-e2e-none-own", targetOrigStash: "asw-e2e-none-target", targetFileMoved: false }));
    const r1 = runFull(home, ["remove", "p", "--yes"]);
    assert.notEqual(r1.status, 0);
    assert.match(r1.stderr, /rebind --restore --profile p/);
    assert.equal(fs.existsSync(path.join(home, "claude", "p")), true, "nothing removed");
    const r2 = runFull(home, ["remove", "p", "--yes", "--force"]);
    assert.equal(r2.status, 0, r2.stderr);
    assert.equal(fs.existsSync(path.join(home, "claude", "p")), false);
    assert.match(r2.stdout, /Dropped its active rebind/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("mappings renders a pool rule as a pool; activity --limit 0 is rejected", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "asw-repo-")));
  try {
    seed(home, "claude", "a");
    run(home, ["pool", "create", "Work"]);
    run(home, ["map", "pool:work", repo]);
    const text = run(home, ["mappings"]);
    assert.match(text, /-> pool:work \(claude\)$/m);
    assert.doesNotMatch(text, /claude\/pool:/);
    const r = runFull(home, ["activity", "--limit", "0"]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /--limit must be a whole number of at least 1/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("remove refuses a profile whose account another profile currently borrows", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  try {
    seed(home, "claude", "a");
    seed(home, "claude", "p");
    fs.writeFileSync(path.join(home, ".agent-switch-rebind-registry.json"), JSON.stringify({ a: { runningProfile: "p", boundAt: "x" } }));
    const r = runFull(home, ["remove", "a", "--yes"]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /rebind --restore --profile p/);
    assert.equal(fs.existsSync(path.join(home, "claude", "a")), true, "nothing removed");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// ---------- login (sign in again on an existing profile) ----------

/** A fake provider binary first on PATH: records argv + its config-dir env, and
 *  on `succeed` writes the login the real CLI would (a refreshable credential). */
function fakeProvider(dir: string, binary: "claude" | "codex", succeed: boolean): string {
  const log = path.join(dir, `${binary}.log`);
  const envVar = binary === "claude" ? "CLAUDE_CONFIG_DIR" : "CODEX_HOME";
  const write =
    binary === "claude"
      ? `printf '%s' '{"claudeAiOauth":{"accessToken":"a","refreshToken":"r","expiresAt":4102444800000}}' > "$${envVar}/.credentials.json"`
      : `printf '%s' '{"tokens":{"access_token":"a","refresh_token":"r"}}' > "$${envVar}/auth.json"`;
  fs.writeFileSync(
    path.join(dir, binary),
    `#!/bin/sh\n[ "$1" = "--version" ] && { echo "1.0.0"; exit 0; }\necho "$*|$${envVar}" >> "${log}"\n${succeed ? write : ""}\nexit 0\n`,
    { mode: 0o755 },
  );
  return log;
}

function runLogin(home: string, bin: string, args: string[]) {
  return spawnSync("node", [CLI, ...args], {
    env: { ...process.env, AGENT_SWITCH_HOME: home, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
    encoding: "utf8",
  });
}

const posixGate = { skip: gate.skip || (process.platform === "win32" ? "fake binaries are POSIX shell scripts" : false) };

test("login: runs `claude auth login` in the profile's config dir and confirms the sign-in", posixGate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "asw-bin-"));
  try {
    seed(home, "claude", "work");
    const log = fakeProvider(bin, "claude", true);
    const r = runLogin(home, bin, ["login", "work"]);
    assert.equal(r.status, 0, r.stderr);
    const cfg = path.join(home, "claude", "work", "config");
    assert.deepEqual(fs.readFileSync(log, "utf8").trim().split("\n"), [`auth login|${cfg}`]);
    assert.match(r.stdout, /signed in/i);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(bin, { recursive: true, force: true });
  }
});

test("login: an unfinished sign-in exits non-zero and says so", posixGate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "asw-bin-"));
  try {
    seed(home, "claude", "work");
    fakeProvider(bin, "claude", false);
    const r = runLogin(home, bin, ["login", "work"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /not signed in/i);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(bin, { recursive: true, force: true });
  }
});

test("login: codex signs in with `codex login` under the profile's CODEX_HOME", posixGate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "asw-bin-"));
  try {
    seed(home, "codex", "w");
    const log = fakeProvider(bin, "codex", true);
    const r = runLogin(home, bin, ["login", "--provider", "codex", "w"]);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(fs.readFileSync(log, "utf8").trim().split("\n"), [`login|${path.join(home, "codex", "w", "config")}`]);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(bin, { recursive: true, force: true });
  }
});

test("login: an unknown profile is refused before anything launches", posixGate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "asw-bin-"));
  try {
    const log = fakeProvider(bin, "claude", true);
    const r = runLogin(home, bin, ["login", "ghost"]);
    assert.notEqual(r.status, 0);
    assert.equal(fs.existsSync(log), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(bin, { recursive: true, force: true });
  }
});

test("login --browser: Claude's sign-in opens in the chosen browser (BROWSER points at it)", posixGate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "asw-bin-"));
  try {
    seed(home, "claude", "work");
    const seen = path.join(bin, "browser-env");
    fs.writeFileSync(path.join(bin, "claude"), `#!/bin/sh\n[ "$1" = "--version" ] && exit 0\nprintf '%s' "$BROWSER" > "${seen}"\nexit 0\n`, { mode: 0o755 });
    let pick: string;
    if (process.platform === "darwin") {
      pick = "safari"; // always present on macOS
    } else {
      fs.writeFileSync(path.join(bin, "firefox"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      pick = "firefox";
    }
    const r = runLogin(home, bin, ["login", "work", "--browser", pick]);
    assert.equal(r.status, 1, "the fake signs nothing in");
    const browser = fs.readFileSync(seen, "utf8");
    if (process.platform === "darwin") {
      assert.equal(browser, path.join(home, "browsers", "safari"));
      assert.match(fs.readFileSync(browser, "utf8"), /open -a '\/Applications\/Safari\.app'/);
    } else {
      assert.equal(browser, path.join(bin, "firefox"));
    }

    const unknown = runLogin(home, bin, ["login", "work", "--browser", "netscape"]);
    assert.notEqual(unknown.status, 0);
    assert.match(unknown.stderr, /browser "netscape" is not installed/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(bin, { recursive: true, force: true });
  }
});

test("add: creates the profile and signs it in with `claude auth login`, not a bare `claude`", posixGate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "asw-bin-"));
  try {
    const log = fakeProvider(bin, "claude", true);
    const r = runLogin(home, bin, ["add", "Client_1"]);
    assert.equal(r.status, 0, r.stderr);
    const cfg = path.join(home, "claude", "Client_1", "config");
    assert.deepEqual(fs.readFileSync(log, "utf8").trim().split("\n"), [`auth login|${cfg}`]);
    // The first plain `claude` run skips Claude Code's own setup screens.
    assert.equal(JSON.parse(fs.readFileSync(path.join(cfg, ".claude.json"), "utf8")).hasCompletedOnboarding, true);
    assert.match(r.stdout, /signed in/i);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(bin, { recursive: true, force: true });
  }
});

test("add: an unfinished sign-in keeps the profile, exits non-zero and names the retry", posixGate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "asw-bin-"));
  try {
    fakeProvider(bin, "codex", false);
    const r = runLogin(home, bin, ["add", "side", "--provider", "codex"]);
    assert.equal(r.status, 1);
    assert.ok(fs.existsSync(path.join(home, "codex", "side")));
    assert.match(r.stderr, /agent-switch login side --provider codex/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(bin, { recursive: true, force: true });
  }
});

test("add --browser: the first sign-in opens in the chosen browser", posixGate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "asw-bin-"));
  try {
    const seen = path.join(bin, "browser-env");
    fs.writeFileSync(path.join(bin, "claude"), `#!/bin/sh\n[ "$1" = "--version" ] && exit 0\nprintf '%s' "$BROWSER" > "${seen}"\nexit 0\n`, { mode: 0o755 });
    let pick = "safari";
    if (process.platform !== "darwin") {
      fs.writeFileSync(path.join(bin, "firefox"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      pick = "firefox";
    }
    runLogin(home, bin, ["add", "work", "--browser", pick]);
    const browser = fs.readFileSync(seen, "utf8");
    assert.equal(browser, process.platform === "darwin" ? path.join(home, "browsers", "safari") : path.join(bin, "firefox"));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(bin, { recursive: true, force: true });
  }
});

test("color: stores a profile's colour, lists it, follows a rename, and goes with the profile", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  try {
    seed(home, "claude", "work");
    const colorOf = (name: string) =>
      (JSON.parse(run(home, ["list", "--json"])) as { name: string; color: string | null }[]).find((r) => r.name === name)?.color;
    assert.equal(colorOf("work"), null);
    run(home, ["color", "work", "teal"]);
    assert.equal(colorOf("work"), "teal");
    run(home, ["rename", "work", "Work2"]);
    assert.equal(colorOf("Work2"), "teal");
    assert.throws(() => run(home, ["color", "Work2", "beige"]), /invalid colour "beige"/);
    run(home, ["color", "Work2", "none"]);
    assert.equal(colorOf("Work2"), null);
    run(home, ["color", "Work2", "pink"]);
    run(home, ["remove", "Work2", "--force"]);
    seed(home, "claude", "Work2");
    assert.equal(colorOf("Work2"), null, "a reused name never inherits the old colour");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

function runIn(home: string, fakeHome: string, args: string[], shell = "/bin/zsh") {
  return spawnSync("node", [CLI, ...args], {
    env: { ...process.env, AGENT_SWITCH_HOME: home, HOME: fakeHome, USERPROFILE: fakeHome, SHELL: shell },
    encoding: "utf8",
  });
}

test("shellenv install: adds the line to the shell's rc file once, and doctor then finds it", { skip: gate.skip || (process.platform === "win32" ? "POSIX rc files" : false) }, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  const fake = fs.mkdtempSync(path.join(os.tmpdir(), "asw-home-"));
  try {
    fs.writeFileSync(path.join(fake, ".zshrc"), "export FOO=1\n");
    const first = runIn(home, fake, ["shellenv", "install", "--json"]);
    assert.equal(first.status, 0, first.stderr);
    const r1 = JSON.parse(first.stdout);
    assert.deepEqual(r1, { shell: "zsh", file: path.join(fake, ".zshrc"), alreadyInstalled: false });
    const rc = fs.readFileSync(path.join(fake, ".zshrc"), "utf8");
    assert.ok(rc.startsWith("export FOO=1\n"), "existing lines stay");
    assert.match(rc, /\neval "\$\(agent-switch shellenv\)"\n$/);

    const again = JSON.parse(runIn(home, fake, ["shellenv", "install", "--json"]).stdout);
    assert.equal(again.alreadyInstalled, true);
    assert.equal(fs.readFileSync(path.join(fake, ".zshrc"), "utf8"), rc, "never added twice");

    const doctor = JSON.parse(runIn(home, fake, ["doctor", "--json"]).stdout);
    const check = doctor.checks.find((c: { id: string }) => c.id === "shell-integration");
    assert.equal(check.status, "ok");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(fake, { recursive: true, force: true });
  }
});

test("shellenv install: fish gets its own line in its own file, created when missing", { skip: gate.skip || (process.platform === "win32" ? "POSIX rc files" : false) }, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  const fake = fs.mkdtempSync(path.join(os.tmpdir(), "asw-home-"));
  try {
    const r = runIn(home, fake, ["shellenv", "install", "--json"], "/opt/homebrew/bin/fish");
    assert.equal(r.status, 0, r.stderr);
    const file = path.join(fake, ".config", "fish", "config.fish");
    assert.equal(JSON.parse(r.stdout).file, file);
    assert.match(fs.readFileSync(file, "utf8"), /agent-switch shellenv --shell fish \| source/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(fake, { recursive: true, force: true });
  }
});

test("disable: keeps the profile, lists it as disabled, refuses use, leaves the active slot, follows a rename; enable undoes it", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  try {
    seed(home, "claude", "work");
    seed(home, "claude", "side");
    run(home, ["use", "work"]);
    const row = (name: string) => (JSON.parse(run(home, ["list", "--json"])) as { name: string; disabled: boolean; active: boolean }[]).find((r) => r.name === name);
    assert.equal(row("work")?.disabled, false);
    run(home, ["disable", "work"]);
    assert.equal(row("work")?.disabled, true);
    assert.equal(row("work")?.active, false, "a disabled account is never the active one");
    assert.ok(fs.existsSync(path.join(home, "claude", "work", "config")), "nothing is deleted");
    assert.throws(() => run(home, ["use", "work"]), /work is disabled — turn it back on first: agent-switch enable work/);
    run(home, ["rename", "work", "Work2"]);
    assert.equal(row("Work2")?.disabled, true);
    run(home, ["enable", "Work2"]);
    assert.equal(row("Work2")?.disabled, false);
    run(home, ["use", "Work2"]);
    run(home, ["disable", "Work2"]);
    run(home, ["remove", "Work2", "--force"]);
    seed(home, "claude", "Work2");
    assert.equal(row("Work2")?.disabled, false, "a reused name starts enabled");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("dir --plain: ignores folder rules and balances by what each account would lose at its reset", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "asw-repo-"));
  try {
    for (const n of ["a", "b"]) {
      const cfg = path.join(home, "claude", n, "config");
      fs.mkdirSync(cfg, { recursive: true });
      fs.writeFileSync(path.join(cfg, ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: `${n}@example.com` } }));
    }
    const sample = (util: number) => ({ samples: [{ at: new Date(Date.now() - 60_000).toISOString(), windows: [{ key: "seven_day", utilization: util }] }] });
    fs.writeFileSync(path.join(home, "claude", "a", "usage-history.json"), JSON.stringify(sample(70)));
    fs.writeFileSync(path.join(home, "claude", "b", "usage-history.json"), JSON.stringify(sample(10)));
    run(home, ["use", "a"]);
    run(home, ["map", "a", repo]);
    const dir = (args: string[]) => JSON.parse(execFileSync("node", [CLI, "dir", "--json", ...args], { env: { ...process.env, AGENT_SWITCH_HOME: home }, encoding: "utf8", cwd: repo }));
    assert.equal(dir([]).profile, "claude/a", "the folder rule decides here");
    const plain = dir(["--plain"]);
    assert.equal(plain.profile, "claude/b");
    assert.match(plain.why[0], /^No folder rule — balancing across 2 claude accounts/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("map --pause / --resume: a paused folder rule is listed as paused and no longer decides", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "asw-repo-"));
  try {
    for (const n of ["a", "b"]) {
      const cfg = path.join(home, "claude", n, "config");
      fs.mkdirSync(cfg, { recursive: true });
      fs.writeFileSync(path.join(cfg, ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: `${n}@example.com` } }));
    }
    run(home, ["use", "b"]);
    run(home, ["map", "a", repo]);
    const dir = () => JSON.parse(execFileSync("node", [CLI, "dir", "--json"], { env: { ...process.env, AGENT_SWITCH_HOME: home }, encoding: "utf8", cwd: repo }));
    const listed = () => JSON.parse(run(home, ["mappings", "--json"]))[0];
    assert.equal(dir().profile, "claude/a");
    assert.equal(listed().paused, false);

    assert.match(run(home, ["map", "--pause", repo]), /Paused/);
    assert.equal(listed().paused, true);
    assert.notEqual(dir().mapping?.name, "a", "a paused rule must not pick the account");

    assert.match(run(home, ["map", "--resume", repo]), /Resumed/);
    assert.equal(listed().paused, false);
    assert.equal(dir().profile, "claude/a");

    const r = spawnSync("node", [CLI, "map", "--pause", path.join(repo, "nothing-here")], { env: { ...process.env, AGENT_SWITCH_HOME: home }, encoding: "utf8" });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /no mapping/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("activate: points terminals at this CLI and leaves a service that isn't installed alone", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  try {
    const r = JSON.parse(run(home, ["activate", "--json"]));
    assert.equal(r.cli, fs.realpathSync(CLI));
    assert.equal(r.service, "not-installed");
    assert.equal(fs.readFileSync(path.join(home, "active-cli"), "utf8").trim(), fs.realpathSync(CLI));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("shell wrapper: `claude` asks the activated CLI, and falls back to agent-switch on PATH when it is gone", { skip: gate.skip || (spawnSync("bash", ["--version"]).status !== 0 ? "no bash" : false) }, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "asw-bin-"));
  try {
    const log = path.join(bin, "calls.log");
    const fakeCli = (name: string) => {
      const p = path.join(bin, name);
      fs.writeFileSync(p, `#!/bin/sh\necho "${name} $*" >> "${log}"\n`, { mode: 0o755 });
      return p;
    };
    const dev = fakeCli("dev-cli");
    fakeCli("agent-switch");
    fs.writeFileSync(path.join(bin, "claude"), `#!/bin/sh\necho "claude $*" >> "${log}"\n`, { mode: 0o755 });
    const script = execFileSync("node", [CLI, "shellenv", "--shell", "bash"], { env: { ...process.env, AGENT_SWITCH_HOME: home }, encoding: "utf8" });
    const call = () =>
      spawnSync("bash", ["-c", `${script}\nclaude hi`], { env: { ...process.env, AGENT_SWITCH_HOME: home, PATH: `${bin}${path.delimiter}${process.env.PATH}` }, encoding: "utf8" });

    fs.writeFileSync(path.join(home, "active-cli"), `${dev}\n`);
    call();
    fs.writeFileSync(path.join(home, "active-cli"), `${path.join(bin, "deleted-worktree", "index.js")}\n`);
    call();
    assert.deepEqual(fs.readFileSync(log, "utf8").trim().split("\n"), [
      "dev-cli dir --provider claude --guard",
      "claude hi",
      "agent-switch dir --provider claude --guard",
      "claude hi",
    ]);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(bin, { recursive: true, force: true });
  }
});

test("sessions/desktop: Claude Desktop sessions show up under the account they ran on, and a foreign login is reported", { skip: gate.skip || (process.platform !== "darwin" ? "the regular app's data dir is the macOS one" : false) }, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "asw-home-"));
  try {
    const uuid = { work: "11111111-1111-4111-8111-111111111111", side: "22222222-2222-4222-8222-222222222222" };
    const org = "33333333-3333-4333-8333-333333333333";
    for (const n of ["work", "side"] as const) {
      const cfg = path.join(home, "claude", n, "config");
      fs.mkdirSync(cfg, { recursive: true });
      fs.writeFileSync(path.join(cfg, ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: `${n}@example.com`, accountUuid: uuid[n] } }));
    }
    const cli = "44444444-4444-4444-8444-444444444444";
    const metaDir = path.join(home, "claude", "work", "gui", "claude-desktop", "claude-code-sessions", uuid.side, org);
    fs.mkdirSync(metaDir, { recursive: true });
    fs.writeFileSync(path.join(metaDir, "local_x.json"), JSON.stringify({ cliSessionId: cli, cwd: "/w/app", title: "From Desktop", createdAt: Date.now() - 60_000 }));
    const proj = path.join(fakeHome, ".claude", "projects", "-w-app");
    fs.mkdirSync(proj, { recursive: true });
    fs.writeFileSync(path.join(proj, `${cli}.jsonl`), "{}\n");
    const env = { ...process.env, AGENT_SWITCH_HOME: home, HOME: fakeHome, CLAUDE_CONFIG_DIR: "" };
    delete (env as Record<string, string | undefined>).CLAUDE_CONFIG_DIR;
    const rows = JSON.parse(execFileSync("node", [CLI, "sessions", "--json"], { env, encoding: "utf8" })) as { profile: string; sessionId: string; surface?: string; summary: string | null }[];
    const hit = rows.find((r) => r.sessionId === cli);
    assert.ok(hit, JSON.stringify(rows));
    assert.equal(hit.profile, "side", "filed under side's account, though it ran in work's Desktop window");
    assert.equal(hit.surface, "desktop-app");
    assert.equal(hit.summary, "From Desktop");
    const inst = JSON.parse(execFileSync("node", [CLI, "desktop", "--json"], { env, encoding: "utf8" })) as { profile: string | null; mismatch: boolean; accounts: { profile: string | null }[] }[];
    assert.deepEqual(inst.map((i) => [i.profile, i.mismatch, i.accounts.map((a) => a.profile)]), [["work", true, ["side"]]]);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(fakeHome, { recursive: true, force: true });
  }
});

test("sessions: a session whose last hook event is Notification, with nothing written since, is waiting on you", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  try {
    seed(home, "claude", "work");
    const proj = path.join(home, "claude", "work", "config", "projects", "-w-app");
    fs.mkdirSync(proj, { recursive: true });
    const id = (n: number) => `${n}${n}${n}${n}${n}${n}${n}${n}-${n}${n}${n}${n}-4${n}${n}${n}-8${n}${n}${n}-${String(n).repeat(12)}`;
    const t0 = Date.now() - 10 * 60_000;
    for (const n of [1, 2, 3]) {
      const f = path.join(proj, `${id(n)}.jsonl`);
      fs.writeFileSync(f, JSON.stringify({ cwd: "/w/app" }) + "\n");
      fs.utimesSync(f, t0 / 1000, t0 / 1000);
    }
    const ev = (n: number, event: string, at: number) => JSON.stringify({ event, sessionId: id(n), at: new Date(at).toISOString() });
    fs.mkdirSync(path.join(home, "events"), { recursive: true });
    fs.writeFileSync(
      path.join(home, "events", "claude-work.jsonl"),
      [ev(1, "Stop", t0 - 1000), ev(1, "Notification", t0 + 1000), ev(2, "Notification", t0 - 60_000), ev(3, "Notification", t0 + 1000), ev(3, "Stop", t0 + 2000)].join("\n") + "\n",
    );
    // Session 2 wrote after its notification: the prompt was answered.
    fs.utimesSync(path.join(proj, `${id(2)}.jsonl`), t0 / 1000, t0 / 1000);
    const rows = JSON.parse(run(home, ["sessions", "--json"])) as { sessionId: string; waiting?: boolean }[];
    const waiting = Object.fromEntries(rows.map((r) => [r.sessionId[0], r.waiting === true]));
    assert.deepEqual(waiting, { "1": true, "2": false, "3": false });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("notify: an identical notice is collapsed, unless --repeat says each one is its own moment", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  try {
    const say = (...extra: string[]) => run(home, ["notify", "--kind", "warning", "--title", "x is waiting for you", "--message", "same", ...extra]);
    say();
    say();
    assert.equal((JSON.parse(run(home, ["notifications", "--json"])) as unknown[]).length, 1);
    say("--repeat");
    assert.equal((JSON.parse(run(home, ["notifications", "--json"])) as unknown[]).length, 2);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("browsers --json lists installed browsers as {id, name}", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e-"));
  try {
    const list = JSON.parse(run(home, ["browsers", "--json"]));
    assert.ok(Array.isArray(list));
    for (const b of list) assert.deepEqual(Object.keys(b).sort(), ["id", "name"]);
    if (process.platform === "darwin") assert.ok(list.some((b: { id: string }) => b.id === "safari"));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
