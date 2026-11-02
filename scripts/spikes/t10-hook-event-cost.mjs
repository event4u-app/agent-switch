#!/usr/bin/env node
// T10 — what does one `agent-switch __hook-event` cost?
// (road-to-hooks-that-keep-up, Phase 0 step 3: the baseline the v3 `as-hook`
// relay is measured against.)
//
// Runs the built CLI (`dist/index.js`) N times with a realistic Stop payload on
// stdin, against a throwaway AGENT_SWITCH_HOME, under `/usr/bin/time -p`, and
// reports wall time and CPU time (user + sys) per event as p50 / p95, plus the
// CPU seconds per 100 events. Run `npm run build` first.
//
// Usage: node scripts/spikes/t10-hook-event-cost.mjs [N=50]
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const n = Number(process.argv[2] ?? 50);
const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "dist", "index.js");
if (!fs.existsSync(cli)) throw new Error(`${cli} missing — run npm run build`);

const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-t10-"));
const cfg = path.join(home, "claude", "probe", "config");
fs.mkdirSync(cfg, { recursive: true });
const payload = JSON.stringify({
  session_id: "00000000-0000-4000-8000-000000000000",
  transcript_path: path.join(cfg, "projects", "x", "s.jsonl"),
  cwd: home,
  permission_mode: "default",
  hook_event_name: "Stop",
  stop_hook_active: false,
});

const wall = [];
const cpu = [];
for (let i = 0; i < n; i++) {
  const t0 = process.hrtime.bigint();
  const r = spawnSync("/usr/bin/time", ["-p", process.execPath, cli, "__hook-event"], {
    input: payload,
    env: { ...process.env, AGENT_SWITCH_HOME: home, CLAUDE_CONFIG_DIR: cfg },
    encoding: "utf8",
  });
  wall.push(Number(process.hrtime.bigint() - t0) / 1e6);
  if (r.status !== 0) throw new Error(`exit ${r.status}: ${r.stderr}`);
  // `time -p` reports in 10 ms steps.
  const sec = (k) => Number((r.stderr.match(new RegExp(`^${k}\\s+([\\d.]+)`, "m")) ?? [])[1] ?? 0);
  cpu.push((sec("user") + sec("sys")) * 1000);
}

const q = (xs, p) => +[...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))].toFixed(1);
const recorded = fs.readFileSync(path.join(home, "events", "claude-probe.jsonl"), "utf8").split("\n").filter(Boolean).length;
console.log(JSON.stringify({
  node: process.version,
  platform: `${os.platform()} ${os.arch()}`,
  events: n,
  recorded,
  wallMs: { p50: q(wall, 0.5), p95: q(wall, 0.95) },
  cpuMs: { p50: q(cpu, 0.5), p95: q(cpu, 0.95) },
  cpuSecondsPer100: +((cpu.reduce((a, b) => a + b, 0) / n) * 100 / 1000).toFixed(2),
}));
fs.rmSync(home, { recursive: true, force: true });
