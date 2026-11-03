import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  codexHandler,
  codexHomeTrust,
  codexHooksInstalled,
  codexHooksNeedMigration,
  codexHooksTrust,
  codexTrustHash,
  hookStates,
  withCodexHooksInstalled,
  withCodexHooksRemoved,
} from "../src/codex-hooks.js";
import { hookAccount, takeInHook } from "../src/hook-intake.js";
import { hookCommand, hookNotice } from "../src/hooks.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = [path.resolve(here, "fixtures/codex-hooks-0.166.0.jsonl"), path.resolve(here, "../../tests/fixtures/codex-hooks-0.166.0.jsonl")].find((p) => fs.existsSync(p))!;

function root(): string {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), "cx-"));
  fs.mkdirSync(path.join(r, "codex", "work", "config"), { recursive: true });
  fs.mkdirSync(path.join(r, "claude", "main", "config"), { recursive: true });
  return r;
}
const home = (r: string) => path.join(r, "codex", "work", "config");
const captured = (r: string) =>
  fs
    .readFileSync(fixture, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l.replaceAll("<ROOT>", r)));
const ring = (r: string, name: string) => {
  try {
    return fs.readFileSync(path.join(r, "events", name), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
};

test("captured Codex 0.166.0 hooks land in the account's ring, without answer text", () => {
  const r = root();
  for (const p of captured(r)) assert.equal(takeInHook(p, { CODEX_HOME: home(r) }, r)?.provider, "codex");
  const lines = ring(r, "codex-work.jsonl");
  assert.deepEqual(lines.map((e) => e.event), ["SessionStart", "Stop", "SessionEnd"]);
  assert.ok(lines.every((e) => e.sessionId === "01a1a071-28c3-7b10-8ac8-60a4f615e389"));
  assert.equal(lines[0].source, "startup");
  assert.deepEqual([lines[0].cwd, lines[1].cwd, lines[2].cwd], ["/work/repo", "/work/repo", undefined]);
  assert.ok(!JSON.stringify(lines).includes("last_assistant_message") && !JSON.stringify(lines).includes("transcript"), "no answer text, no transcript path");
});

test("an inherited config dir of the other tool does not take the event: the transcript's dir decides", () => {
  const r = root();
  const claudeCfg = path.join(r, "claude", "main", "config");
  const [start] = captured(r);
  // Codex started from inside a Claude session inherits CLAUDE_CONFIG_DIR and CLAUDE_PID.
  const t = takeInHook(start, { CLAUDE_CONFIG_DIR: claudeCfg, CLAUDE_PID: "4242", CODEX_HOME: home(r) }, r);
  assert.equal(t?.provider, "codex");
  assert.equal(t?.record.hostPid, undefined, "CLAUDE_PID names a Claude process, not this one");
  assert.equal(ring(r, "claude-main.jsonl").length, 0);
  // And Claude started from a Codex shell keeps its own account.
  const claudeStop = { hook_event_name: "Stop", session_id: "c1", transcript_path: path.join(claudeCfg, "projects", "x", "c1.jsonl") };
  assert.deepEqual(hookAccount(claudeStop, { CLAUDE_CONFIG_DIR: claudeCfg, CODEX_HOME: home(r) }, r), { provider: "claude", profile: "main" });
  // No transcript: Claude's dir first, as before Codex hooks existed.
  assert.deepEqual(hookAccount({}, { CLAUDE_CONFIG_DIR: claudeCfg, CODEX_HOME: home(r) }, r), { provider: "claude", profile: "main" });
  assert.deepEqual(hookAccount({}, { CODEX_HOME: home(r) }, r), { provider: "codex", profile: "work" });
  assert.equal(hookAccount({}, { CODEX_HOME: "/elsewhere/.codex" }, r), null);
});

test("a Codex turn end says Codex, not Claude", () => {
  assert.equal(hookNotice({ event: "Stop", at: "" }, { provider: "codex", profile: "work" })?.title, "Codex finished");
  assert.equal(hookNotice({ event: "Stop", at: "" }, { provider: "claude", profile: "main" })?.title, "Claude finished");
});

test("hooks.json: ours added beside the user's, moved with the relay, removed alone", () => {
  const cli = hookCommand("agent-switch");
  const viaRelay = hookCommand("agent-switch", "/r/bin/as-hook");
  const mine = { matcher: "startup", hooks: [{ type: "command", command: "my-notify.sh" }] };
  const file = { description: "user's", hooks: { SessionStart: [mine], PreToolUse: [{ hooks: [{ type: "command", command: "guard" }] }] } };

  const on = withCodexHooksInstalled(file, cli);
  assert.ok(codexHooksInstalled(on, cli));
  assert.deepEqual(on.hooks!.SessionStart[0], mine, "the user's group stays first and unchanged");
  assert.equal(on.hooks!.SessionStart.length, 2);
  assert.deepEqual(on.hooks!.PreToolUse, file.hooks.PreToolUse);
  assert.equal(on.description, "user's");
  assert.deepEqual(withCodexHooksInstalled(on, cli), on, "idempotent");
  assert.deepEqual(on.hooks!.SessionEnd[0].hooks[0], { type: "command", command: cli, timeout: 3, async: false }, "SessionEnd runs synchronously inside Codex's 3 s cap");
  assert.deepEqual(on.hooks!.Stop[0].hooks[0], codexHandler("Stop", cli));

  assert.ok(codexHooksNeedMigration(on, viaRelay) && !codexHooksNeedMigration(file, viaRelay));
  const moved = withCodexHooksInstalled(on, viaRelay);
  assert.ok(codexHooksInstalled(moved, viaRelay));
  assert.equal(moved.hooks!.SessionStart.length, 2, "moved in place, not added twice");

  assert.deepEqual(withCodexHooksRemoved(moved), file);
  assert.deepEqual(withCodexHooksRemoved(withCodexHooksInstalled({}, cli)), {});
});

test("trust hash: the one Codex 0.166.0 wrote for a real approval", () => {
  // From a real `[hooks.state]` entry: a Stop handler in ~/.codex/hooks.json, approved in Codex.
  const command =
    'BIN="$CLAUDE_PROJECT_DIR/agent-config"; [ -x "$BIN" ] || BIN=agent-config; "$BIN" dispatch:hook --platform claude --event stop --native-event Stop --project-dir "$CLAUDE_PROJECT_DIR" --min-version 1';
  assert.equal(
    codexTrustHash("stop", { type: "command", command, timeout: 600, async: false }),
    "sha256:e550989dac6a3c9cdb01b4cc20dd95afabbd2de918b840379b995a1007907393",
  );
  assert.notEqual(codexTrustHash("stop", { type: "command", command, timeout: 600, async: false }, "x"), codexTrustHash("stop", { type: "command", command, timeout: 600, async: false }));
});

test("trust is read, never written: awaiting → approved → changed → disabled", () => {
  const cli = hookCommand("agent-switch");
  const file = withCodexHooksInstalled({ hooks: { Stop: [{ hooks: [{ type: "command", command: "mine" }] }] } }, cli);
  const p = "/h/hooks.json";
  assert.equal(codexHooksTrust(file, "", [p]), "awaiting");
  const label = { SessionStart: "session_start", Stop: "stop", SessionEnd: "session_end" } as const;
  const approve = (f: typeof file, extra = "") =>
    (Object.keys(label) as (keyof typeof label)[])
      .map((ev) => {
        const gi = f.hooks![ev].findIndex((g: any) => g.hooks[0].command.endsWith("__hook-event"));
        return `[hooks.state."${p}:${label[ev]}:${gi}:0"]\ntrusted_hash = "${codexTrustHash(label[ev], f.hooks![ev][gi].hooks[0])}"\n${extra}`;
      })
      .join("\n");
  const toml = approve(file);
  assert.equal(codexHooksTrust(file, toml, [p]), "approved");
  assert.equal(codexHooksTrust(file, toml, ["/other/hooks.json"]), "awaiting", "keyed on the file's path");
  assert.equal(codexHooksTrust(withCodexHooksInstalled(file, hookCommand("agent-switch", "/r/as-hook")), toml, [p]), "changed");
  assert.equal(codexHooksTrust(file, approve(file, "enabled = false\n"), [p]), "disabled");
  assert.deepEqual([...hookStates('[a]\ntrusted_hash = "no"\n[hooks.state."q\\"x"]\nenabled = true\n')], [['q"x', { enabled: true }]]);
});

test("hooks install --provider codex writes the account's hooks.json and says it waits for approval", () => {
  const r = root();
  const cli = [path.resolve(here, "../../dist/index.js"), path.resolve(here, "../dist/index.js")].find((p) => fs.existsSync(p));
  if (!cli) return;
  const run = (...a: string[]) => spawnSync(process.execPath, [cli, ...a], { env: { ...process.env, AGENT_SWITCH_HOME: r }, encoding: "utf8", timeout: 20_000 });
  fs.writeFileSync(path.join(home(r), "hooks.json"), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "mine" }] }] } }));
  const on = run("hooks", "install", "work", "--provider", "codex");
  assert.equal(on.status, 0, on.stderr);
  assert.match(on.stdout, /codex\/work: install done · installed, not approved yet/);
  assert.equal(codexHomeTrust(home(r)), "awaiting");
  const file = JSON.parse(fs.readFileSync(path.join(home(r), "hooks.json"), "utf8"));
  assert.equal(file.hooks.Stop[0].hooks[0].command, "mine");
  assert.equal(file.hooks.Stop[1].hooks[0].command, "agent-switch __hook-event");
  assert.match(run("hooks", "status", "--provider", "codex").stdout, /codex\/work: installed, not approved yet/);
  assert.equal(run("hooks", "uninstall", "work", "--provider", "codex").status, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home(r), "hooks.json"), "utf8")), { hooks: { Stop: [{ hooks: [{ type: "command", command: "mine" }] }] } });
  assert.match(run("hooks", "status", "--provider", "codex").stdout, /codex\/work: not installed/);
  assert.equal(fs.existsSync(path.join(r, "claude", "main", "config", "settings.json")), false, "Claude untouched");
});
