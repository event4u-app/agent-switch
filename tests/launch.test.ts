import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { LAUNCH_PLAIN_EXIT, envScript, launch, type LaunchDeps } from "../src/commands/launch.js";
import type { HostedSession, StartOptions } from "../src/host/tmux-host.js";

const ID = "0755915b-4a83-438b-8ca5-0cffe5a5993d";

function fake(over: Partial<LaunchDeps> = {}) {
  const envDir = fs.mkdtempSync(path.join(os.tmpdir(), "asw-launch-"));
  const calls: { started: StartOptions[]; ended: string[]; closed: string[]; attached: string[][]; logs: string[]; envSeen: string[] } = { started: [], ended: [], closed: [], attached: [], logs: [], envSeen: [] };
  let dead: { dead: boolean; status: number | null } = { dead: true, status: 3 };
  const deps: LaunchDeps = {
    ctx: { enabled: true, platform: "darwin", tmux: true, stdinTty: true, stdoutTty: true, insideHost: false },
    cwd: "/w/app",
    env: { PATH: "/usr/bin:/opt/bin", PROJECT_TOKEN_NAME: "it's here", TMUX: "/tmp/tmux-1/default,1,0", TERM: "xterm-256color", CLAUDE_CONFIG_DIR: "/somewhere/else", PWD: "/w/app", "BAD-NAME": "x" },
    accountOfDir: (_p, dir) => (dir === "/as/claude/work/config" ? "work" : null),
    accountHolding: () => null,
    newestInFolder: () => null,
    configDir: (_p, a) => `/as/claude/${a}/config`,
    bin: () => "/bin/claude",
    extraArgs: () => [],
    extraEnv: () => ({ AGENT_CONFIG_HOME: "/ac" }),
    envDir,
    host: {
      start: (o) => {
        calls.started.push(o);
        if (o.envFile) calls.envSeen.push(fs.readFileSync(o.envFile, "utf8"), (fs.statSync(o.envFile).mode & 0o777).toString(8));
        return { key: `${o.provider}/${o.account}/${o.sessionId ?? "new-id"}`, provider: o.provider, account: o.account, sessionId: o.sessionId ?? "new-id", window: "@7", cwd: o.cwd, startedAt: "t" } satisfies HostedSession;
      },
      view: (key, viewer) => [`attach ${key} ${viewer}`],
      paneState: () => dead,
      closeView: (v) => void calls.closed.push(v),
      end: (k) => void calls.ended.push(k),
    },
    attach: async (argv, watch) => {
      calls.attached.push(argv);
      return watch() ? "ended" : "detached";
    },
    log: (m) => void calls.logs.push(m),
    ...over,
  };
  return { deps, calls, envDir, setDead: (d: typeof dead) => void (dead = d) };
}

test("a hosted start: routed account, the shell's own environment, this terminal as its view; the program's end ends it", async () => {
  const { deps, calls, envDir } = fake();
  const code = await launch("claude", "/as/claude/work/config", ["--model", "opus", "fix it"], deps);
  assert.equal(code, 3);
  const o = calls.started[0];
  assert.equal(o.account, "work");
  assert.equal(o.configDir, "/as/claude/work/config");
  assert.equal(o.cwd, "/w/app");
  assert.deepEqual(o.args, ["--model", "opus", "fix it"]);
  assert.deepEqual(o.env, { AGENT_CONFIG_HOME: "/ac" });
  const [script, mode] = calls.envSeen;
  assert.equal(mode, "600");
  assert.match(script, /^export PATH='\/usr\/bin:\/opt\/bin'$/m);
  assert.match(script, /^export PROJECT_TOKEN_NAME='it'\\''s here'$/m);
  // The host's own variables and the outer terminal's are not carried over.
  for (const k of ["TMUX", "TERM", "CLAUDE_CONFIG_DIR", "PWD", "BAD-NAME", "AGENT_CONFIG_HOME"]) assert.doesNotMatch(script, new RegExp(`^export ${k}=`, "m"), k);
  assert.equal(calls.attached.length, 1);
  assert.deepEqual(calls.ended, ["claude/work/new-id"]);
  assert.equal(calls.closed.length, 1);
  assert.deepEqual(fs.readdirSync(envDir), [], "the window removes its env file; a test host does not, so launch must not leave one behind either");
});

test("detaching leaves it running and says how to come back", async () => {
  const { deps, calls, setDead } = fake();
  setDead({ dead: false, status: null });
  assert.equal(await launch("claude", "/as/claude/work/config", [], deps), 0);
  assert.deepEqual(calls.ended, []);
  assert.match(calls.logs.join("\n"), /agent-switch host attach claude\/work\/new-id/);
});

test("a resume keeps its id and goes to the account that holds the transcript; -c resumes the folder's newest", async () => {
  const a = fake({ accountHolding: (_p, id) => (id === ID ? "side" : null) });
  await launch("claude", "/as/claude/work/config", ["--resume", ID], a.deps);
  assert.equal(a.calls.started[0].account, "side");
  assert.equal(a.calls.started[0].sessionId, ID);
  assert.deepEqual(a.calls.started[0].args, ["--resume", ID]);

  const b = fake({ newestInFolder: (_p, acct, cwd) => (acct === "work" && cwd === "/w/app" ? ID : null) });
  await launch("claude", "/as/claude/work/config", ["-c"], b.deps);
  assert.equal(b.calls.started[0].sessionId, ID);
  assert.deepEqual(b.calls.started[0].args, ["--resume", ID]);

  const c = fake();
  await launch("claude", "/as/claude/work/config", ["--continue"], c.deps);
  assert.equal(c.calls.started[0].sessionId, undefined, "nothing to continue: a new session");
  assert.deepEqual(c.calls.started[0].args, []);
});

test("a plain plan, an unknown config dir or a failed start fall back to the plain start and leave nothing behind", async () => {
  const off = fake();
  off.deps.ctx = { ...off.deps.ctx, enabled: false };
  assert.equal(await launch("claude", "/as/claude/work/config", [], off.deps), LAUNCH_PLAIN_EXIT);
  assert.equal(off.calls.started.length, 0);

  const unknown = fake();
  assert.equal(await launch("claude", "/elsewhere", [], unknown.deps), LAUNCH_PLAIN_EXIT);
  assert.equal(unknown.calls.started.length, 0);

  const failing = fake();
  failing.deps.host.start = () => {
    throw new Error("tmux could not start the session: boom");
  };
  assert.equal(await launch("claude", "/as/claude/work/config", [], failing.deps), LAUNCH_PLAIN_EXIT);
  assert.deepEqual(fs.readdirSync(failing.envDir), []);
  assert.match(failing.calls.logs.join("\n"), /boom/);
  assert.equal(failing.calls.attached.length, 0);
});

test("envScript quotes every value for sh and drops names a shell cannot take", () => {
  const s = envScript({ A: "x y", B: "$(rm -rf ~)", C: "line1\nline2", "D-E": "no", _: "/usr/bin/env", F: undefined }, new Set());
  assert.equal(s, "export A='x y'\nexport B='$(rm -rf ~)'\nexport C='line1\nline2'\n");
});
