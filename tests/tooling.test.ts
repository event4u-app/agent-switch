import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  TOOL_IDS,
  checkTooling,
  findOnPath,
  formatToolingLines,
  doctorToolingLine,
  parseVersionToken,
  planToolAction,
  probeRtkIdentity,
  runToolAction,
  statusGlyph,
  type RunResult,
  type Runner,
  type ToolAction,
  type ToolStatus,
} from "../src/tooling.js";

// ---------- helpers -----------------------------------------------------------

/** Canned-output runner keyed by `<basename> <args…>`; unknown keys succeed
 *  silently, so a test only specifies the probes it cares about. */
function stubRunner(map: Record<string, Partial<RunResult>>): Runner {
  return (cmd, args) => {
    const r = map[`${path.basename(cmd)} ${args.join(" ")}`] ?? {};
    return { stdout: "", stderr: "", status: 0, failedToStart: false, timedOut: false, ...r };
  };
}

/** A temp PATH dir holding executable stub binaries with the given names. */
function stubBinDir(...names: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asw-tooling-"));
  for (const n of names) fs.writeFileSync(path.join(dir, n), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  return dir;
}

const noLinks = () => null;

// ---------- rtk identity probe (quad-state, stubbed runner) --------------------

test("probeRtkIdentity: Token Savings signature → token-killer, version from `rtk --version`", () => {
  const run = stubRunner({
    "rtk gain": { stdout: "RTK Token Savings\n  total saved: 123k tokens\n" },
    "rtk --version": { stdout: "rtk 1.4.2\n" },
  });
  assert.deepEqual(probeRtkIdentity("/x/rtk", run), { identity: "token-killer", version: "1.4.2" });
});

test("probeRtkIdentity: unknown-subcommand output → unknown-rtk (name collision)", () => {
  const run = stubRunner({
    "rtk gain": { stderr: "error: unrecognized subcommand 'gain'\n", status: 2 },
  });
  assert.deepEqual(probeRtkIdentity("/x/rtk", run), { identity: "unknown-rtk", version: null });
});

test("probeRtkIdentity: timeout → unverified (a broken right tool is not the wrong tool)", () => {
  const run = stubRunner({ "rtk gain": { timedOut: true, status: null } });
  assert.deepEqual(probeRtkIdentity("/x/rtk", run), { identity: "unverified", version: null });
});

test("probeRtkIdentity: crash-on-start and silent run are both unverified, never unknown-rtk", () => {
  const crashed = stubRunner({ "rtk gain": { failedToStart: true, status: null } });
  assert.equal(probeRtkIdentity("/x/rtk", crashed).identity, "unverified");
  const silent = stubRunner({ "rtk gain": { stdout: "", stderr: "", status: 1 } });
  assert.equal(probeRtkIdentity("/x/rtk", silent).identity, "unverified");
});

test("probeRtkIdentity judges the signature, not the exit code", () => {
  // Non-zero exit but the real header on stdout — still Token Killer.
  const run = stubRunner({
    "rtk gain": { stdout: "Token Savings (no history yet)\n", status: 1 },
    "rtk --version": { stdout: "rtk 0.9.0\n" },
  });
  assert.deepEqual(probeRtkIdentity("/x/rtk", run), { identity: "token-killer", version: "0.9.0" });
});

// ---------- PATH lookup ---------------------------------------------------------

test("findOnPath finds a stub binary on a temp PATH dir and returns its full path", () => {
  const dir = stubBinDir("rtk");
  try {
    assert.equal(findOnPath("rtk", dir, "linux"), path.join(dir, "rtk"));
    assert.equal(findOnPath("agent-config", dir, "linux"), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("findOnPath skips empty PATH segments and non-executable files (POSIX)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asw-tooling-"));
  try {
    fs.writeFileSync(path.join(dir, "rtk"), "not a binary", { mode: 0o644 });
    const searchPath = ["", dir, ""].join(path.delimiter);
    // A data file named `rtk` without the executable bit does not count.
    if (process.platform !== "win32") assert.equal(findOnPath("rtk", searchPath, "linux"), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("parseVersionToken extracts the first version-looking token", () => {
  assert.equal(parseVersionToken("rtk 1.4.2\n"), "1.4.2");
  assert.equal(parseVersionToken("v2.0.1-beta.3"), "2.0.1-beta.3");
  assert.equal(parseVersionToken("agent-config version 0.12.0 (node 22)"), "0.12.0");
  assert.equal(parseVersionToken("no version here"), null);
});

// ---------- tooling sweep (--json contract shape) --------------------------------

const CONTRACT_KEYS = ["healthy", "hint", "id", "path", "present", "version"];

function assertContractShape(t: ToolStatus): void {
  const keys = Object.keys(t).sort();
  // `identity` appears only for tools with a collision risk (rtk) that were
  // actually found — an absent tool has nothing to judge.
  const expected = t.id === "rtk" && t.present ? [...CONTRACT_KEYS, "identity"].sort() : CONTRACT_KEYS;
  assert.deepEqual(keys, expected, `contract keys for ${t.id}`);
  assert.equal(typeof t.present, "boolean");
  assert.equal(typeof t.healthy, "boolean");
  assert.equal(typeof t.hint, "string");
  assert.ok(t.version === null || typeof t.version === "string");
  assert.ok(t.path === null || typeof t.path === "string");
}

test("checkTooling: empty PATH → every tool present:false with an actionable hint", () => {
  const dir = stubBinDir(); // no binaries
  try {
    const tools = checkTooling({ searchPath: dir, platform: "linux", linked: noLinks, run: stubRunner({}) });
    assert.deepEqual(tools.map((t) => t.id), [...TOOL_IDS]);
    for (const t of tools) {
      assertContractShape(t);
      assert.equal(t.present, false);
      assert.equal(t.version, null);
      assert.equal(t.path, null);
      assert.equal(t.healthy, false);
      assert.ok(t.hint.length > 0, `${t.id} hint is actionable`);
    }
    // Absent rtk carries NO identity — nothing was probed.
    assert.equal("identity" in tools.find((t) => t.id === "rtk")!, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("checkTooling: healthy sweep — versions parsed, rtk verified as token-killer", () => {
  const dir = stubBinDir("agent-config", "rtk", "claude", "codex", "agy");
  const run = stubRunner({
    "agent-config --version": { stdout: "1.2.3\n" },
    "rtk gain": { stdout: "RTK Token Savings\n" },
    "rtk --version": { stdout: "rtk 1.4.2\n" },
    "claude --version": { stdout: "2.1.0 (Claude Code)\n" },
    "codex --version": { stdout: "codex-cli 0.42.0\n" },
    "agy --version": { stdout: "0.3.1\n" },
  });
  try {
    const tools = checkTooling({ searchPath: dir, platform: "linux", linked: noLinks, run });
    for (const t of tools) {
      assertContractShape(t);
      assert.equal(t.present, true, `${t.id} present`);
      assert.equal(t.healthy, true, `${t.id} healthy`);
      assert.equal(t.path, path.join(dir, t.id));
      assert.equal(t.hint, "");
    }
    const byId = new Map(tools.map((t) => [t.id, t]));
    assert.equal(byId.get("agent-config")?.version, "1.2.3");
    assert.deepEqual(byId.get("rtk"), {
      id: "rtk",
      present: true,
      version: "1.4.2",
      path: path.join(dir, "rtk"),
      healthy: true,
      identity: "token-killer",
      hint: "",
    });
    assert.equal(byId.get("codex")?.version, "0.42.0");
    // identity appears ONLY for rtk (collision risk); never for the others.
    for (const t of tools) assert.equal("identity" in t, t.id === "rtk");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("checkTooling: wrong rtk on PATH → present but unhealthy, identity unknown-rtk", () => {
  const dir = stubBinDir("rtk");
  const run = stubRunner({ "rtk gain": { stderr: "error: unrecognized subcommand 'gain'\n", status: 2 } });
  try {
    const [t] = checkTooling({ ids: ["rtk"], searchPath: dir, platform: "darwin", linked: noLinks, run });
    assert.equal(t.present, true);
    assert.equal(t.healthy, false);
    assert.equal(t.identity, "unknown-rtk");
    assert.match(t.hint, /name collision/);
    assert.match(t.hint, /brew install rtk/); // per-OS install command (darwin)
    assert.equal(statusGlyph(t), "⚠️"); // present-but-unhealthy, not absent
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("checkTooling: rtk probe timeout → unverified, unhealthy, no install-command hint", () => {
  const dir = stubBinDir("rtk");
  const run = stubRunner({ "rtk gain": { timedOut: true, status: null } });
  try {
    const [t] = checkTooling({ ids: ["rtk"], searchPath: dir, platform: "linux", linked: noLinks, run });
    assert.equal(t.identity, "unverified");
    assert.equal(t.healthy, false);
    assert.match(t.hint, /timed out or crashed/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("checkTooling: present binary whose --version probe fails → unhealthy with hint", () => {
  const dir = stubBinDir("agent-config");
  const run = stubRunner({ "agent-config --version": { failedToStart: true, status: null } });
  try {
    const [t] = checkTooling({ ids: ["agent-config"], searchPath: dir, platform: "linux", linked: noLinks, run });
    assert.equal(t.present, true);
    assert.equal(t.healthy, false);
    assert.equal(t.version, null);
    assert.match(t.hint, /agent-config --version/);
    assert.match(t.hint, /npm install -g @event4u\/agent-config/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("checkTooling: a user-linked provider binary wins over PATH (resolveBinary precedence)", () => {
  const dir = stubBinDir(); // nothing on PATH
  const linkedDir = stubBinDir("claude");
  const linkedPath = path.join(linkedDir, "claude");
  const run = stubRunner({ "claude --version": { stdout: "2.1.0\n" } });
  try {
    const [t] = checkTooling({
      ids: ["claude"],
      searchPath: dir,
      platform: "linux",
      linked: (id) => (id === "claude" ? linkedPath : null),
      run,
    });
    assert.equal(t.present, true);
    assert.equal(t.path, linkedPath);
    assert.equal(t.version, "2.1.0");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(linkedDir, { recursive: true, force: true });
  }
});

test("hints carry the per-OS rtk install command (never `cargo install rtk`)", () => {
  const dir = stubBinDir();
  try {
    const hintFor = (platform: NodeJS.Platform) =>
      checkTooling({ ids: ["rtk"], searchPath: dir, platform, linked: noLinks, run: stubRunner({}) })[0].hint;
    assert.match(hintFor("darwin"), /brew install rtk/);
    assert.match(hintFor("linux"), /install\.sh \| sh/);
    assert.match(hintFor("win32"), /winget install rtk-ai\.rtk/);
    for (const p of ["darwin", "linux", "win32"] as const) assert.doesNotMatch(hintFor(p), /cargo install/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- install / upgrade command map (pure, per OS) --------------------------

/** Unwrap a plan that must carry a command (fails the test on a refusal). */
function commandOf(id: Parameters<typeof planToolAction>[0], action: ToolAction, opts?: Parameters<typeof planToolAction>[2]) {
  const plan = planToolAction(id, action, opts);
  assert.ok("command" in plan, `${id} ${action} should plan a command`);
  return (plan as { command: { cmd: string; args: string[]; display: string } }).command;
}

test("planToolAction: npm tools — install plain, upgrade @latest (exact argv)", () => {
  const cases = [
    ["agent-config", "@event4u/agent-config"],
    ["claude", "@anthropic-ai/claude-code"],
    ["codex", "@openai/codex"],
  ] as const;
  for (const [id, pkg] of cases) {
    const install = commandOf(id, "install", { platform: "linux" });
    assert.equal(install.cmd, "npm");
    assert.deepEqual(install.args, ["install", "-g", pkg]);
    assert.equal(install.display, `npm install -g ${pkg}`);
  }
  // upgrade without a claude binary present → npm @latest for all three.
  for (const [id, pkg] of cases) {
    const upgrade = commandOf(id, "upgrade", { platform: "linux", claudePath: null });
    assert.deepEqual(upgrade.args, ["install", "-g", `${pkg}@latest`]);
  }
});

test("planToolAction: claude upgrade prefers the CLI's own `claude update` when the binary is present", () => {
  const viaCli = commandOf("claude", "upgrade", { platform: "darwin", claudePath: "/opt/bin/claude" });
  assert.deepEqual(viaCli, { cmd: "/opt/bin/claude", args: ["update"], display: "claude update" });
  // install never uses `claude update`, even with a binary present.
  const install = commandOf("claude", "install", { platform: "darwin", claudePath: "/opt/bin/claude" });
  assert.deepEqual(install.args, ["install", "-g", "@anthropic-ai/claude-code"]);
});

test("planToolAction: rtk per OS — brew (darwin), winget (win32), upstream installer (linux), NEVER cargo", () => {
  assert.deepEqual(commandOf("rtk", "install", { platform: "darwin" }), {
    cmd: "brew",
    args: ["install", "rtk"],
    display: "brew install rtk",
  });
  assert.deepEqual(commandOf("rtk", "upgrade", { platform: "darwin" }), {
    cmd: "brew",
    args: ["upgrade", "rtk"],
    display: "brew upgrade rtk",
  });
  assert.deepEqual(commandOf("rtk", "install", { platform: "win32" }), {
    cmd: "winget",
    args: ["install", "rtk-ai.rtk"],
    display: "winget install rtk-ai.rtk",
  });
  assert.deepEqual(commandOf("rtk", "upgrade", { platform: "win32" }), {
    cmd: "winget",
    args: ["upgrade", "rtk-ai.rtk"],
    display: "winget upgrade rtk-ai.rtk",
  });
  for (const action of ["install", "upgrade"] as const) {
    const linux = commandOf("rtk", action, { platform: "linux" });
    assert.equal(linux.cmd, "sh");
    assert.deepEqual(linux.args, ["-c", "curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/master/install.sh | sh"]);
  }
  for (const platform of ["darwin", "linux", "win32"] as const) {
    for (const action of ["install", "upgrade"] as const) {
      const c = commandOf("rtk", action, { platform });
      assert.doesNotMatch(`${c.cmd} ${c.args.join(" ")} ${c.display}`, /cargo/);
    }
  }
});

test("planToolAction: agy is an honest refusal (no invented command), pointing at providers link", () => {
  for (const action of ["install", "upgrade"] as const) {
    const plan = planToolAction("agy", action, { platform: "darwin" });
    assert.ok("refusal" in plan, "agy plans no command");
    const refusal = (plan as { refusal: string }).refusal;
    assert.match(refusal, /Antigravity app/);
    assert.match(refusal, /providers link --provider antigravity --path/);
  }
});

// ---------- runToolAction (injectable runner — nothing really installs) -----------

function recordingRun(status: number) {
  const calls: { cmd: string; args: string[] }[] = [];
  const run = (cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    return status;
  };
  return { calls, run };
}

test("runToolAction prints the exact command first, runs it, and returns the child's exit code", () => {
  const { calls, run } = recordingRun(0);
  const logs: string[] = [];
  const rc = runToolAction("codex", "install", { platform: "linux", run, log: (l) => logs.push(l), error: () => {} });
  assert.equal(rc, 0);
  assert.deepEqual(calls, [{ cmd: "npm", args: ["install", "-g", "@openai/codex"] }]);
  assert.equal(logs[0], "→ npm install -g @openai/codex");
  assert.match(logs[1], /✅ codex installed/);
});

test("runToolAction on a failing child: non-zero passthrough, failure surfaced, output stays visible", () => {
  const { calls, run } = recordingRun(7);
  const errors: string[] = [];
  const rc = runToolAction("rtk", "upgrade", { platform: "darwin", run, log: () => {}, error: (l) => errors.push(l) });
  assert.equal(rc, 7);
  assert.deepEqual(calls, [{ cmd: "brew", args: ["upgrade", "rtk"] }]);
  assert.match(errors[0], /`brew upgrade rtk` exited with 7/);
});

test("runToolAction on agy: refusal path exits 1 and never invokes the runner", () => {
  const { calls, run } = recordingRun(0);
  const errors: string[] = [];
  const rc = runToolAction("agy", "install", { platform: "linux", run, log: () => {}, error: (l) => errors.push(l) });
  assert.equal(rc, 1);
  assert.deepEqual(calls, []);
  assert.match(errors[0], /Antigravity app/);
});

test("runToolAction claude upgrade: injected claudePath → `claude update`; null → npm @latest", () => {
  const viaCli = recordingRun(0);
  runToolAction("claude", "upgrade", { platform: "darwin", run: viaCli.run, claudePath: "/x/claude", log: () => {}, error: () => {} });
  assert.deepEqual(viaCli.calls, [{ cmd: "/x/claude", args: ["update"] }]);

  const viaNpm = recordingRun(0);
  runToolAction("claude", "upgrade", { platform: "darwin", run: viaNpm.run, claudePath: null, log: () => {}, error: () => {} });
  assert.deepEqual(viaNpm.calls, [{ cmd: "npm", args: ["install", "-g", "@anthropic-ai/claude-code@latest"] }]);
});

// ---------- renderers -----------------------------------------------------------

test("formatToolingLines: aligned rows with codebase glyphs; doctorToolingLine is doctor-styled", () => {
  const dir = stubBinDir("rtk");
  const run = stubRunner({
    "rtk gain": { stdout: "RTK Token Savings\n" },
    "rtk --version": { stdout: "rtk 1.4.2\n" },
  });
  try {
    const tools = checkTooling({ searchPath: dir, platform: "linux", linked: noLinks, run });
    const lines = formatToolingLines(tools);
    assert.equal(lines.length, tools.length);
    assert.match(lines.find((l) => l.includes("rtk 1.4.2".split(" ")[0])) ?? "", /^✅ {2}rtk/u);
    for (const l of lines) assert.match(l, /^(✅|⚠️|❌) {2}\S/u);
    // Absent tools render ❌ + the install hint.
    assert.match(lines.find((l) => l.includes("agent-config")) ?? "", /^❌.*npm install -g @event4u\/agent-config/u);

    const rtk = tools.find((t) => t.id === "rtk")!;
    assert.equal(doctorToolingLine(rtk), "`rtk` 1.4.2 is installed (Token Killer verified).");
    const missing = tools.find((t) => t.id === "agent-config")!;
    assert.match(doctorToolingLine(missing), /^`agent-config`: not installed — install:/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- built-CLI integration (same gate as cli-e2e.test.ts) ------------------

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist/index.js");
const gate = { skip: fs.existsSync(CLI) ? false : "run `npm run build` first (dist/index.js missing)" };

function runCli(home: string, args: string[]): string {
  return execFileSync("node", [CLI, ...args], {
    env: { ...process.env, AGENT_SWITCH_HOME: home },
    encoding: "utf8",
  });
}

test("`tooling --json` emits the contract shape for all five tools", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-tooling-e2e-"));
  try {
    const tools = JSON.parse(runCli(home, ["tooling", "--json"])) as ToolStatus[];
    assert.deepEqual(tools.map((t) => t.id), [...TOOL_IDS]);
    for (const t of tools) assertContractShape(t);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("`tooling install` with an unknown or missing id is a usage error (exit 1)", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-tooling-e2e-"));
  try {
    for (const args of [["tooling", "install", "notatool"], ["tooling", "upgrade"], ["tooling", "bogus-sub"]]) {
      assert.throws(
        () => runCli(home, args),
        (err: any) => err.status === 1 && /usage: agent-switch tooling/.test(String(err.stderr)),
        `${args.join(" ")} should fail with usage`,
      );
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("`tooling install agy` refuses honestly with exit 1 (no invented command runs)", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-tooling-e2e-"));
  try {
    assert.throws(
      () => runCli(home, ["tooling", "install", "agy"]),
      (err: any) => err.status === 1 && /Antigravity app/.test(String(err.stderr)),
    );
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("`doctor` includes the agent-config and rtk rows", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-tooling-e2e-"));
  try {
    const out = runCli(home, ["doctor"]);
    assert.match(out, /`agent-config`/);
    assert.match(out, /`rtk`/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
