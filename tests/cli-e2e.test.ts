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
