import { test } from "node:test";
import assert from "node:assert/strict";

import { terminalStartPlan, type StartContext } from "../src/terminal-sync.js";

const ctx = (over: Partial<StartContext> = {}): StartContext => ({ enabled: true, platform: "darwin", tmux: true, stdinTty: true, stdoutTty: true, insideHost: false, ...over });
const reason = (p: ReturnType<typeof terminalStartPlan>) => (p.kind === "plain" ? p.reason : null);

test("an interactive claude start runs hosted, its arguments kept", () => {
  assert.deepEqual(terminalStartPlan("claude", [], ctx()), { kind: "hosted", args: [] });
  assert.deepEqual(terminalStartPlan("claude", ["fix the login bug"], ctx()), { kind: "hosted", args: ["fix the login bug"] });
  assert.deepEqual(terminalStartPlan("claude", ["--model", "opus", "--effort", "high"], ctx()), { kind: "hosted", args: ["--model", "opus", "--effort", "high"] });
  // A first prompt that happens to start with a subcommand's word is still a prompt when it is not that word.
  assert.deepEqual(terminalStartPlan("claude", ["update the readme"], ctx()), { kind: "hosted", args: ["update the readme"] });
});

test("a resume keeps its id in every spelling; --session-id becomes the host's own id", () => {
  const id = "0755915b-4a83-438b-8ca5-0cffe5a5993d";
  for (const argv of [["--resume", id], ["-r", id], [`--resume=${id}`]]) {
    assert.deepEqual(terminalStartPlan("claude", [...argv, "--model", "opus"], ctx()), { kind: "hosted", args: ["--resume", id, "--model", "opus"], sessionId: id }, argv.join(" "));
  }
  assert.deepEqual(terminalStartPlan("claude", ["--session-id", id, "hi"], ctx()), { kind: "hosted", args: ["hi"], sessionId: id });
  assert.deepEqual(terminalStartPlan("claude", ["-c"], ctx()), { kind: "hosted", args: [], continue: true });
  assert.deepEqual(terminalStartPlan("claude", ["--continue", "--model", "opus"], ctx()), { kind: "hosted", args: ["--model", "opus"], continue: true });
});

test("anything that is not an interactive session runs as before, and says why", () => {
  const plain = (argv: string[], c: Partial<StartContext> = {}, provider: "claude" | "codex" = "claude") => reason(terminalStartPlan(provider, argv, ctx(c)));
  assert.equal(plain([], { enabled: false }), "off");
  assert.equal(plain([], { platform: "win32" }), "no-host");
  assert.equal(plain([], { tmux: false }), "no-host");
  assert.equal(plain([], { stdinTty: false }), "not-a-terminal");
  assert.equal(plain([], { stdoutTty: false }), "not-a-terminal");
  assert.equal(plain([], { insideHost: true }), "inside-host");
  for (const argv of [["-p", "hi"], ["--print", "hi"], ["hi", "--output-format", "json"], ["--input-format", "stream-json"], ["-v"], ["--version"], ["-h"], ["--help"]]) assert.equal(plain(argv), "not-interactive", argv.join(" "));
  for (const sub of ["mcp", "config", "doctor", "update", "install", "setup-token", "plugin", "migrate-installer", "agents"]) assert.equal(plain([sub, "list"]), "subcommand", sub);
  // A bare resume opens the picker; a fork makes an id nobody knows yet.
  assert.equal(plain(["--resume"]), "picker");
  assert.equal(plain(["-r", "--model", "opus"]), "picker");
  assert.equal(plain(["--resume", "0755915b-4a83-438b-8ca5-0cffe5a5993d", "--fork-session"]), "fork");
  assert.equal(plain(["--resume", "not an id"]), "picker");
});

test("codex: a plain start or a prompt is hosted; every subcommand runs as before", () => {
  assert.deepEqual(terminalStartPlan("codex", [], ctx()), { kind: "hosted", args: [] });
  assert.deepEqual(terminalStartPlan("codex", ["-m", "gpt-5.5", "explain this repo"], ctx()), { kind: "hosted", args: ["-m", "gpt-5.5", "explain this repo"] });
  for (const sub of ["exec", "e", "login", "logout", "mcp", "resume", "fork", "apply", "cloud", "completion", "sandbox", "help"]) {
    assert.equal(reason(terminalStartPlan("codex", [sub], ctx())), "subcommand", sub);
  }
  assert.equal(reason(terminalStartPlan("codex", ["--version"], ctx())), "not-interactive");
});
