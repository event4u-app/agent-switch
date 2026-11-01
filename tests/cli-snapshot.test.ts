import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// Byte-identical output snapshots of the BUILT CLI (`dist/index.js`), taken from
// the build BEFORE `src/index.ts` was split by command family (roadmap step 4.1,
// decision D6). The split is a pure move: any drift here — help text, a JSON
// shape, an exit code, a stderr line — is a behaviour change and fails the test.
//
// Help/usage cases run everywhere (the text is static). Cases that read a seeded
// fixture home carry paths and per-OS store behaviour, so they run on the
// platform the snapshots were generated on (darwin — CI's macos-latest job).
//
// Regenerate (only when output is MEANT to change):
//   npm run build && UPDATE_CLI_SNAPSHOTS=1 npm test

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist/index.js");
const gate = { skip: fs.existsSync(CLI) ? false : "run `npm run build` first (dist/index.js missing)" };
const UPDATE = process.env.UPDATE_CLI_SNAPSHOTS === "1";
const SNAPSHOT_PLATFORM = "darwin";

/** Walk UP from the compiled test to the repo's tests/fixtures (the suite runs from dist-test/). */
function snapshotDir(): string {
  const rel = path.join("tests", "fixtures", "cli-snapshots");
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, "tests", "fixtures"))) return path.join(dir, rel);
    dir = path.dirname(dir);
  }
  throw new Error(`fixture directory ${rel} not found above ${fileURLToPath(import.meta.url)}`);
}

function exec(home: string, args: string[]): { stdout: string; stderr: string; status: number | null } {
  const res = spawnSync("node", [CLI, ...args], {
    // HOME/USERPROFILE point into the fixture too, so nothing reads the real ~/.claude.
    env: { ...process.env, AGENT_SWITCH_HOME: home, HOME: home, USERPROFILE: home, NO_COLOR: "1" },
    encoding: "utf8",
  });
  return { stdout: res.stdout, stderr: res.stderr, status: res.status };
}

function render(home: string, args: string[]): string {
  const { stdout, stderr, status } = exec(home, args);
  const real = fs.realpathSync(home);
  const norm = (s: string) => s.split(real).join("<HOME>").split(home).join("<HOME>");
  return `${norm(stdout)}--- stderr ---\n${norm(stderr)}--- exit ${status} ---\n`;
}

function check(name: string, actual: string): void {
  const file = path.join(snapshotDir(), `${name}.txt`);
  if (UPDATE) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, actual);
    return;
  }
  assert.ok(fs.existsSync(file), `missing snapshot ${file} (generate with UPDATE_CLI_SNAPSHOTS=1)`);
  // git may check fixtures out with CRLF on Windows; the CLI itself writes LF.
  const expected = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  assert.equal(actual, expected, `output of \`${name}\` drifted from its snapshot`);
}

/** A fixture home: claude/{work,home} + codex/work, work active + labelled, home coloured, one folder rule. */
function seedHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-snap-"));
  for (const [prov, name] of [["claude", "work"], ["claude", "home"], ["codex", "work"]]) {
    const dir = path.join(home, prov, name, "config");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, prov === "claude" ? ".claude.json" : "auth.json"), "{}");
  }
  fs.mkdirSync(path.join(home, "proj"));
  for (const args of [["use", "work"], ["label", "work", "Work"], ["color", "home", "teal"], ["map", "work", path.join(home, "proj")]]) {
    const r = exec(home, args);
    if (r.status !== 0) throw new Error(`seed \`${args.join(" ")}\` failed: ${r.stderr}`);
  }
  return home;
}

const HELP_CASES: Array<[string, string[]]> = [
  ["help", ["help"]],
  ["help--help", ["--help"]],
  ["help-h", ["-h"]],
  ["unknown-command", ["no-such-command"]],
];

const FIXTURE_CASES: Array<[string, string[]]> = [
  ["list", ["list"]],
  ["list--json", ["list", "--json"]],
  ["list--format-cswap-v1", ["list", "--format", "cswap-v1"]],
  ["--list--json", ["--list", "--json"]],
  ["current", ["current"]],
  ["whoami-work", ["whoami", "work"]],
  ["status--json", ["status", "--json"]],
  ["dir", ["dir"]],
  ["dir--json", ["dir", "--json"]],
  ["mappings", ["mappings"]],
  ["mappings--json", ["mappings", "--json"]],
  ["pool--json", ["pool", "--json"]],
  ["protection--json", ["protection", "--json"]],
  ["picks--json", ["picks", "--json"]],
  ["guard--json", ["guard", "--json"]],
  ["sessions--json", ["sessions", "--json"]],
  ["desktop--json", ["desktop", "--json"]],
  ["notifications--json", ["notifications", "--json"]],
  ["autoswitch-status--json", ["autoswitch", "status", "--json"]],
  ["share-status--json", ["share", "status", "--json"]],
  ["usage-history--json", ["usage", "history", "--json"]],
  ["alerts-status", ["alerts", "status"]],
  ["hooks-status", ["hooks", "status"]],
  ["os-notify-status--json", ["os-notify", "status", "--json"]],
  ["keep-signed-in-status--json", ["keep-signed-in", "status", "--json"]],
  ["version", ["version"]],
  ["usage-error-add", ["add"]],
  ["usage-error-tooling", ["tooling", "bogus"]],
];

for (const [name, args] of HELP_CASES) {
  test(`snapshot: agent-switch ${args.join(" ")}`, gate, () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-snap-"));
    try {
      check(name, render(home, args));
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
}

const fixtureGate = {
  skip: gate.skip || (process.platform !== SNAPSHOT_PLATFORM ? `fixture snapshots are ${SNAPSHOT_PLATFORM}-generated` : false),
};

test("snapshot: read-only commands against a fixture home", fixtureGate, async (t) => {
  const home = seedHome();
  try {
    for (const [name, args] of FIXTURE_CASES) {
      await t.test(`agent-switch ${args.join(" ")}`, () => check(name, render(home, args)));
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
