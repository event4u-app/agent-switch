import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const cli = path.join(repo, "dist", "index.js");

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : sources(p);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

/** The first word of every CLI call the GUI makes (`runCli([...])`, `cliCall([...])`, a terminal run's `args: [...]`). */
function guiCommands(): string[] {
  const found = new Set<string>();
  for (const f of sources(path.join(repo, "gui", "src"))) {
    const s = fs.readFileSync(f, "utf8");
    for (const m of s.matchAll(/(?:runCli|cliCall|\bcli|Command\.create\("agent-switch",|\bargs:)\s*\(?\s*\[\s*"([a-z][a-z-]*)"/g)) found.add(m[1]);
  }
  return [...found].sort();
}

// Never the real ~/.agent-switch: `host` without help would list real sessions.
const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-help-"));
const env = { ...process.env, AGENT_SWITCH_HOME: home, HOME: home, USERPROFILE: home };
const help = () => spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8", env }).stdout;

test("--help lists every command the GUI runs", () => {
  const text = help();
  const listed = new Set([...text.matchAll(/agent-switch (?:\[[^\]]*\] )?([a-z][a-z-]*)/g)].map((m) => m[1]));
  const cmds = guiCommands();
  assert.ok(cmds.includes("host") && cmds.includes("needs"), "the scan finds the GUI's calls");
  assert.deepEqual(cmds.filter((c) => !listed.has(c)), []);
});

test("host --help prints the host usage, not the hosted session list", () => {
  for (const flag of ["--help", "-h"]) {
    const r = spawnSync(process.execPath, [cli, "host", flag], { encoding: "utf8", env });
    assert.equal(r.status, 0, flag);
    assert.match(r.stdout, /agent-switch host start/, flag);
    assert.doesNotMatch(r.stdout, /No hosted sessions|hosting needs tmux/, flag);
  }
});
