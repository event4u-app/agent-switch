#!/usr/bin/env node
// S7 — ccusage delegation viability (D2 gate). Probes whether ccusage can be
// invoked as an optional external tool, accepts a CLAUDE_CONFIG_DIR target,
// and emits machine-readable per-day/per-model output. Uses `npx ccusage` so
// no global install is required for the probe.
//
// PASS → Phase 5 delegates to ccusage. FAIL → Phase 5 falls back to the parked
// own-aggregator design.

import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const green = (s) => `\x1b[32m${s}\x1b[0m`, red = (s) => `\x1b[31m${s}\x1b[0m`;
const info = (s) => console.log(`\x1b[36m[s7]\x1b[0m ${s}`);
const CLAUDE = process.env.CLAUDE_CONFIG_DIR?.split(",")[0] || join(homedir(), ".claude");

function run(args, extraEnv = {}) {
  info(`npx ${args.join(" ")}`);
  return spawnSync("npx", ["-y", "ccusage@latest", ...args], {
    encoding: "utf8", timeout: 180_000,
    env: { ...process.env, ...extraEnv },
  });
}

// 1. version / availability
let r = run(["--version"]);
if (r.status !== 0 && !r.stdout) {
  console.log(red(`NULL: ccusage not runnable via npx — ${(r.stderr || r.error?.message || "").slice(0, 200)}`));
  process.exit(2);
}
info(`ccusage version: ${(r.stdout || "").trim() || "(unknown)"}`);

// 2. machine-readable daily output against the real claude config dir
r = run(["daily", "--json"], { CLAUDE_CONFIG_DIR: CLAUDE });
const out = (r.stdout || "").trim();
let json = null;
try { json = JSON.parse(out); } catch { /* maybe non-json */ }

console.log("\n--- ccusage daily --json probe ---");
console.log(`exit: ${r.status}, stdout bytes: ${out.length}, parsed JSON: ${json ? "yes" : "no"}`);
if (json) {
  const arr = Array.isArray(json) ? json : json.daily || json.data || Object.values(json)[0];
  const sample = Array.isArray(arr) ? arr[0] : json;
  console.log(`sample keys: ${sample ? Object.keys(sample).join(", ") : "(none)"}`);
  console.log(`sample: ${JSON.stringify(sample).slice(0, 400)}`);
}

const pass = !!json;
console.log(pass
  ? green("\nPASS: ccusage runnable + emits parseable JSON against a target config dir → D2 delegation viable")
  : red("\nFAIL: ccusage JSON not obtained → Phase 5 uses the parked own-aggregator"));
process.exit(pass ? 0 : 1);
