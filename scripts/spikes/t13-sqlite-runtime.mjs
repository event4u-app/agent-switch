#!/usr/bin/env node
// T13 / S4 — event-store runtime: Node `node:sqlite` vs Bun `bun:sqlite`
// (road-to-agent-switch-v3-central, Phase 0; feeds Decision E1).
//
// Runs under either runtime. Opens one SQLite file in WAL mode, starts W writer
// processes of the SAME runtime that each insert N rows (one transaction per
// row, as hook ingest would), then checks that every row arrived and reports
// throughput. A reader process polls the table the whole time, so a writer
// that blocks readers shows up too.
//
//   node scripts/spikes/t13-sqlite-runtime.mjs [W=8] [N=500]
//   bun  scripts/spikes/t13-sqlite-runtime.mjs [W=8] [N=500]
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const isBun = typeof globalThis.Bun !== "undefined";
const runtime = isBun ? `bun ${Bun.version}` : `node ${process.version}`;

async function open(file) {
  if (isBun) {
    const { Database } = await import("bun:sqlite");
    const db = new Database(file);
    return { exec: (sql) => db.exec(sql), run: (sql, ...a) => db.prepare(sql).run(...a), all: (sql) => db.prepare(sql).all(), close: () => db.close() };
  }
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(file);
  return { exec: (sql) => db.exec(sql), run: (sql, ...a) => db.prepare(sql).run(...a), all: (sql) => db.prepare(sql).all(), close: () => db.close() };
}

const [mode, ...rest] = process.argv.slice(2);

if (mode === "--writer") {
  const [file, w, n] = rest;
  const db = await open(file);
  db.exec("PRAGMA busy_timeout = 5000");
  for (let i = 0; i < Number(n); i++) db.run("INSERT INTO events (producer, seq, at) VALUES (?, ?, ?)", `w${w}`, i, Date.now());
  db.close();
  process.exit(0);
}

if (mode === "--reader") {
  const [file, stopFile] = rest;
  const db = await open(file);
  db.exec("PRAGMA busy_timeout = 5000");
  let reads = 0;
  let maxMs = 0;
  while (!fs.existsSync(stopFile)) {
    const t0 = performance.now();
    db.all("SELECT count(*) AS c FROM events");
    maxMs = Math.max(maxMs, performance.now() - t0);
    reads++;
  }
  db.close();
  console.log(JSON.stringify({ reads, maxReadMs: +maxMs.toFixed(2) }));
  process.exit(0);
}

const W = Number(mode ?? 8);
const N = Number(rest[0] ?? 500);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asw-t13-"));
const file = path.join(dir, "store.db");
const db = await open(file);
db.exec("PRAGMA journal_mode = WAL");
db.exec("CREATE TABLE events (id INTEGER PRIMARY KEY, producer TEXT NOT NULL, seq INTEGER NOT NULL, at INTEGER NOT NULL, UNIQUE (producer, seq))");
const exe = process.execPath;
const script = new URL(import.meta.url).pathname;
const child = (args) =>
  new Promise((resolve, reject) => {
    let out = "";
    const p = spawn(exe, [script, ...args], { stdio: ["ignore", "pipe", "inherit"] });
    p.stdout.on("data", (c) => (out += c));
    p.on("error", reject);
    p.on("exit", (code) => (code === 0 ? resolve(out) : reject(new Error(`${args[0]} exited ${code}`))));
  });

const stop = path.join(dir, "stop");
const reader = child(["--reader", file, stop]);
const t0 = performance.now();
await Promise.all(Array.from({ length: W }, (_, w) => child(["--writer", file, String(w), String(N)])));
const ms = performance.now() - t0;
fs.writeFileSync(stop, "");
const readerStats = JSON.parse(await reader);
const [{ c }] = db.all("SELECT count(*) AS c FROM events");
const [{ journal_mode }] = db.all("PRAGMA journal_mode");
db.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log(JSON.stringify({ runtime, journal_mode, writers: W, perWriter: N, expected: W * N, stored: Number(c), ms: Math.round(ms), rowsPerSec: Math.round((W * N) / (ms / 1000)), reader: readerStats }));
