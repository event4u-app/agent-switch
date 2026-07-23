import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import type { HistorySample } from "../src/history.js";

// ---------- built-CLI integration (same gate as tooling.test.ts) ------------------

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist/index.js");
const gate = { skip: fs.existsSync(CLI) ? false : "run `npm run build` first (dist/index.js missing)" };

function runCli(home: string, args: string[]): string {
  return execFileSync("node", [CLI, ...args], {
    env: { ...process.env, AGENT_SWITCH_HOME: home },
    encoding: "utf8",
  });
}

/** A minimal profile (provider/name/config) plus an optional usage-history
 *  fixture — the exact file the daemon writes (`<profileDir>/usage-history.json`). */
function seedProfile(home: string, provider: string, name: string, samples?: HistorySample[]): void {
  const dir = path.join(home, provider, name);
  fs.mkdirSync(path.join(dir, "config"), { recursive: true });
  if (samples) {
    fs.writeFileSync(path.join(dir, "usage-history.json"), JSON.stringify({ schema: 1, samples }, null, 2) + "\n");
  }
}

const FIXTURE: HistorySample[] = [
  { at: "2026-07-22T10:00:00.000Z", windows: [{ key: "five_hour", utilization: 12 }, { key: "seven_day", utilization: 3 }] },
  { at: "2026-07-22T11:00:00.000Z", windows: [{ key: "five_hour", utilization: 40 }, { key: "seven_day", utilization: null }] },
];

test("`usage history --json` emits [{ profile, samples }] for every claude profile", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-usage-hist-"));
  try {
    seedProfile(home, "claude", "work", FIXTURE);
    seedProfile(home, "claude", "personal"); // no history yet → samples: []
    const rows = JSON.parse(runCli(home, ["usage", "history", "--json"])) as { profile: string; samples: HistorySample[] }[];
    assert.deepEqual(
      rows.map((r) => r.profile).sort(),
      ["personal", "work"],
    );
    const work = rows.find((r) => r.profile === "work")!;
    assert.deepEqual(work.samples, FIXTURE); // full ring passthrough — at + windows verbatim
    assert.deepEqual(rows.find((r) => r.profile === "personal")!.samples, []);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("`usage history --profile <name>` filters to that profile", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-usage-hist-"));
  try {
    seedProfile(home, "claude", "work", FIXTURE);
    seedProfile(home, "claude", "personal", FIXTURE);
    const rows = JSON.parse(runCli(home, ["usage", "history", "--profile", "work", "--json"])) as { profile: string }[];
    assert.deepEqual(rows.map((r) => r.profile), ["work"]);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("`usage history` human output is a one-line summary per profile (count + span)", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-usage-hist-"));
  try {
    seedProfile(home, "claude", "work", FIXTURE);
    seedProfile(home, "claude", "personal");
    const out = runCli(home, ["usage", "history"]);
    assert.match(out, /claude\/work: 2 samples \(2026-07-22T10:00:00\.000Z → 2026-07-22T11:00:00\.000Z\)/);
    assert.match(out, /claude\/personal: no usage history yet/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("`usage` guards: unknown subcommand, unknown --profile, and no profiles all exit 1", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-usage-hist-"));
  try {
    seedProfile(home, "claude", "work", FIXTURE);
    assert.throws(
      () => runCli(home, ["usage", "bogus"]),
      (err: any) => err.status === 1 && /usage: agent-switch usage history/.test(String(err.stderr)),
    );
    assert.throws(
      () => runCli(home, ["usage", "history", "--profile", "nope"]),
      (err: any) => err.status === 1,
    );
    assert.throws(
      () => runCli(home, ["usage", "history", "--provider", "codex"]),
      (err: any) => err.status === 1 && /no codex profiles/.test(String(err.stderr)),
    );
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
