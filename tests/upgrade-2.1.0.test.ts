import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// The files under tests/fixtures/upgrade-2.1.0/home are what 2.1.0's writers
// produce (state.json, mappings.json, telemetry-config.json, usage-history.json,
// the layout marker), with values that differ from every default so a reader
// that falls back to one is caught. The current readers and writers run over a
// copy of that tree.

const REPO = (() => {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6 && !fs.existsSync(path.join(dir, "src", "index.ts")); i++) dir = path.dirname(dir);
  return dir;
})();
const FIXTURE = path.join(REPO, "tests", "fixtures", "upgrade-2.1.0", "home");
const CLI = path.join(REPO, "dist", "index.js");

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "asw-upgrade-210-"));
fs.cpSync(FIXTURE, HOME, { recursive: true });
process.env.AGENT_SWITCH_HOME = HOME;

const P = await import("../src/profiles.js");
const M = await import("../src/mappings.js");
const N = await import("../src/notify.js");
const H = await import("../src/history.js");
const PR = await import("../src/protection.js");

const fixture = (rel: string) => JSON.parse(fs.readFileSync(path.join(FIXTURE, rel), "utf8"));
const onDisk = (rel: string) => JSON.parse(fs.readFileSync(path.join(HOME, rel), "utf8"));
/** The 2.1.0 keys of a state, as they are now on disk. */
const as210 = (state: Record<string, unknown>) => Object.fromEntries(Object.keys(fixture("state.json")).map((k) => [k, state[k]]));

test("2.1.0 state: labels, auto-switch, providers, linked binary, OS notifications, rebind breaker and guard read as written", () => {
  const s = P.readState();
  assert.deepEqual(as210(s as unknown as Record<string, unknown>), fixture("state.json"));
});

test("2.1.0 state survives a write by this version: only the changed label differs", () => {
  P.setLabel("claude", "home", "Other");
  const want = fixture("state.json");
  want.labels["claude/home"] = "Other";
  assert.deepEqual(as210(onDisk("state.json")), want);
  P.setLabel("claude", "home", "Personal");
  assert.deepEqual(as210(onDisk("state.json")), fixture("state.json"));
});

test("2.1.0 folder bindings load per provider and survive a new binding", () => {
  assert.deepEqual(M.loadMappings(), fixture("mappings.json").mappings);
  const added = M.setMapping(HOME, "claude", "work");
  const after = M.loadMappings();
  assert.deepEqual(after[added], { claude: "work" });
  delete after[added];
  assert.deepEqual(after, fixture("mappings.json").mappings);
  assert.equal(onDisk("mappings.json").schema, 2);
});

test("2.1.0 alerts: notify and the context thresholds read as written and survive a toggle", () => {
  assert.deepEqual(N.readTelemetryConfig(HOME), fixture("telemetry-config.json"));
  N.writeTelemetryConfig(HOME, { ...N.readTelemetryConfig(HOME), notify: false });
  assert.deepEqual(onDisk("telemetry-config.json"), { ...fixture("telemetry-config.json"), notify: false });
});

test("2.1.0 usage history: every sample, including a window with no reading, reads as written and stays on an append", () => {
  for (const rel of ["claude/work/usage-history.json", "codex/w/usage-history.json"]) {
    assert.deepEqual(H.readHistory(path.join(HOME, rel)), fixture(rel).samples);
  }
  const file = path.join(HOME, "claude", "work", "usage-history.json");
  const next = H.recordHistorySample(file, { windows: [{ key: "five_hour", label: "5h", utilization: 50, resetsAt: null }], routines: null, capturedAt: "2026-05-01T11:00:00.000Z" });
  assert.deepEqual(next.slice(0, -1), fixture("claude/work/usage-history.json").samples);
  assert.equal(next.length, 3);
});

test("2.1.0 had no protection file: every profile it knew reads the default, and none is written by reading", () => {
  for (const [prov, name] of [["claude", "work"], ["claude", "home"], ["codex", "w"]] as const) {
    assert.deepEqual(PR.readProtection(prov, name), PR.DEFAULT_PROTECTION);
  }
  assert.equal(fs.existsSync(PR.PROTECTION_FILE), false);
});

test("the built CLI reads the 2.1.0 tree the same way", { skip: fs.existsSync(CLI) ? false : "run `npm run build` first" }, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-upgrade-210-cli-"));
  try {
    fs.cpSync(FIXTURE, home, { recursive: true });
    const run = (args: string[]) => {
      const r = spawnSync("node", [CLI, ...args], { env: { ...process.env, AGENT_SWITCH_HOME: home }, encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
      return JSON.parse(r.stdout);
    };
    assert.equal(run(["guard", "--json"]).policy, "off");
    assert.deepEqual(run(["alerts", "--json"]), fixture("telemetry-config.json"));
    const history = run(["usage", "history", "--json"]);
    assert.deepEqual(history.find((r: { profile: string }) => r.profile === "work").samples, fixture("claude/work/usage-history.json").samples);
    const list = JSON.stringify(run(["list", "--json"]));
    for (const label of ["Work", "Personal"]) assert.ok(list.includes(`"${label}"`), `label ${label} is listed`);
    for (const rel of ["state.json", "mappings.json", "telemetry-config.json", "claude/work/usage-history.json", "codex/w/usage-history.json"]) {
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, rel), "utf8")), fixture(rel), `${rel} unchanged by reading`);
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test.after(() => fs.rmSync(HOME, { recursive: true, force: true }));
