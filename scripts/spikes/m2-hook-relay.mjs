#!/usr/bin/env node
// M2 — what does a hook cost through the `as-hook` relay, and does any event get
// lost under contention? (road-to-agent-switch-v3-central Phase 1, M2; decision
// E1: measure the acknowledged path — stored, not merely received — on macOS,
// Linux and Windows, and let the runtime follow from the numbers.)
//
// Paths, each against a throwaway AGENT_SWITCH_HOME:
//   node-floor     `node -e 0` — what any Node relay pays before its first line
//   cli            `node dist/index.js __hook-event` — the 2.x path (baseline)
//   relay          `as-hook <cli>` with a running engine (acknowledged = stored)
//   relay-fallback `as-hook <cli>` with no engine — the relay, then the CLI
// Sequential: N runs, wall p50 / p95 (and CPU on Unix via /usr/bin/time).
// Contention: N hooks started at once; wall p95 per hook and events lost
// (expected vs. ring lines vs. store rows).
//
// Usage: node scripts/spikes/m2-hook-relay.mjs [N=50] [--json out.json]
// Needs `npm run build` and `cargo build --release --manifest-path relay/Cargo.toml`.
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const n = Number(args.find((a) => /^\d+$/.test(a)) ?? 50);
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;
const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const cli = path.join(repo, "dist", "index.js");
const relay = process.env.AS_HOOK_BIN ?? path.join(repo, "relay", "target", "release", process.platform === "win32" ? "as-hook.exe" : "as-hook");
for (const f of [cli, relay]) if (!fs.existsSync(f)) throw new Error(`${f} missing — build it first`);
const runJs = pathToFileURL(path.join(repo, "dist", "engine", "run.js")).href;
const { Store, storeFile } = await import(pathToFileURL(path.join(repo, "dist", "store", "store.js")).href);

// Short root: the engine socket path must fit the Unix limit.
const fresh = () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "m2-"));
  fs.mkdirSync(path.join(home, "claude", "probe", "config"), { recursive: true });
  return home;
};
const payload = (i) =>
  JSON.stringify({ session_id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, cwd: os.tmpdir(), hook_event_name: "Stop", stop_hook_active: false });
const env = (home) => ({ ...process.env, AGENT_SWITCH_HOME: home, CLAUDE_CONFIG_DIR: path.join(home, "claude", "probe", "config") });
const ringLines = (home) => {
  try {
    return fs.readFileSync(path.join(home, "events", "claude-probe.jsonl"), "utf8").split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
};
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};
// The engine runs in its own process, as under the daemon: a spawnSync here
// would otherwise block the very engine the relay is waiting for.
function engineProcess(home) {
  const code = `const { startEngine } = await import(${JSON.stringify(runJs)}); const e = await startEngine(process.argv[1], () => {}); console.log(e ? "ready" : "off"); process.on("SIGTERM", async () => { await e?.stop(); process.exit(0); });`;
  const c = spawn(process.execPath, ["--input-type=module", "-e", code, home], { stdio: ["ignore", "pipe", "inherit"] });
  return new Promise((resolve, reject) => {
    c.stdout.once("data", (d) => (String(d).trim() === "ready" ? resolve(c) : reject(new Error("the engine did not start"))));
    c.once("exit", () => reject(new Error("the engine exited")));
  });
}
const stopEngine = (c) => new Promise((resolve) => (c.once("exit", resolve), c.kill("SIGTERM")));

const timeBin = process.platform !== "win32" && fs.existsSync("/usr/bin/time") ? "/usr/bin/time" : null;

const PATHS = {
  "node-floor": { argv: [process.execPath, "-e", "0"], engine: false, stores: false },
  cli: { argv: [process.execPath, cli, "__hook-event"], engine: false, stores: true },
  relay: { argv: [relay, process.execPath, cli, "__hook-event"], engine: true, stores: true },
  "relay-fallback": { argv: [relay, process.execPath, cli, "__hook-event"], engine: false, stores: true },
};

function sequential(p, home) {
  const wall = [];
  const cpu = [];
  for (let i = 0; i < n; i++) {
    const argv = timeBin ? [timeBin, "-p", ...p.argv] : p.argv;
    const t0 = performance.now();
    const r = spawnSync(argv[0], argv.slice(1), { input: payload(i), env: env(home), encoding: "utf8" });
    wall.push(performance.now() - t0);
    if (timeBin) {
      const v = (k) => Number(new RegExp(`^${k}\\s+([\\d.]+)`, "m").exec(r.stderr)?.[1] ?? NaN);
      cpu.push((v("user") + v("sys")) * 1000);
    }
  }
  return { wall, cpu };
}

function contention(p, home, offset) {
  return new Promise((resolve) => {
    const wall = [];
    let left = n;
    for (let i = 0; i < n; i++) {
      const t0 = performance.now();
      const c = spawn(p.argv[0], p.argv.slice(1), { env: env(home), stdio: ["pipe", "ignore", "ignore"] });
      c.stdin.end(payload(offset + i));
      c.on("exit", () => {
        wall.push(performance.now() - t0);
        if (--left === 0) resolve(wall);
      });
    }
  });
}

const rows = [];
for (const [name, p] of Object.entries(PATHS)) {
  const home = fresh();
  const engine = p.engine ? await engineProcess(home) : null;
  // One warm-up run, so the first spawn's disk cache is not in the numbers.
  spawnSync(p.argv[0], p.argv.slice(1), { input: payload(9999), env: env(home) });
  const before = ringLines(home);
  const seq = sequential(p, home);
  const par = await contention(p, home, n);
  const stored = ringLines(home) - before;
  let rowsInStore = null;
  if (engine) {
    await stopEngine(engine);
    const s = await Store.open(storeFile(home));
    rowsInStore = s.eventCount() - 1; // minus the warm-up
    s.close();
  }
  rows.push({
    path: name,
    seqP50: pct(seq.wall, 0.5),
    seqP95: pct(seq.wall, 0.95),
    cpuP50: seq.cpu.length ? pct(seq.cpu, 0.5) : null,
    cpuPer100: seq.cpu.length ? seq.cpu.reduce((a, b) => a + b, 0) / seq.cpu.length / 10 : null,
    contP95: pct(par, 0.95),
    expected: p.stores ? 2 * n : 0,
    ring: stored,
    store: rowsInStore,
  });
}

const f = (x) => (x == null || Number.isNaN(x) ? "–" : x.toFixed(1));
const head = `as-hook relay · ${process.platform}-${process.arch} · Node ${process.version} · N=${n} · CPUs ${os.cpus().length}`;
console.log(head);
console.log("| path | seq wall p50 ms | seq wall p95 ms | CPU p50 ms | CPU s / 100 | 50-parallel wall p95 ms | events expected | in ring | in store |");
console.log("|---|---:|---:|---:|---:|---:|---:|---:|---:|");
for (const r of rows) console.log(`| ${r.path} | ${f(r.seqP50)} | ${f(r.seqP95)} | ${f(r.cpuP50)} | ${r.cpuPer100 == null ? "–" : r.cpuPer100.toFixed(2)} | ${f(r.contP95)} | ${r.expected} | ${r.ring} | ${r.store ?? "–"} |`);
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ head, rows }, null, 2));
const lost = rows.filter((r) => r.expected && (r.ring !== r.expected || (r.store != null && r.store !== r.expected)));
if (lost.length) {
  console.error(`events lost or doubled on: ${lost.map((r) => r.path).join(", ")}`);
  process.exit(1);
}
