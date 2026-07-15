#!/usr/bin/env node
// S1 — Claude transcript shape (D0 gate for road-to-agent-switch-session-telemetry).
//
// Verifies, against REAL local transcripts under CLAUDE_CONFIG_DIR/projects
// (default ~/.claude), that the fields the telemetry adapter depends on are
// present: per-line sessionId / isSidechain / requestId / message.{id,model,usage},
// the streaming intermediates (stop_reason: null), and the nested-layout
// occurrence. Also samples whether post-/clear-resume forks reuse message.id.
//
// Emits scrubbed fixtures to tests/fixtures/claude-transcript-lines.jsonl
// (structure kept, human text replaced) for CI-stable Phase-1 unit tests.
//
// Read-only except for the fixture write. No content leaves the machine.
// PASS/FAIL to stdout; exit 0 PASS, 1 FAIL, 2 honest-null (no transcripts).

import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = process.env.CLAUDE_CONFIG_DIR?.split(",")[0] || join(homedir(), ".claude");
const PROJECTS = join(ROOT, "projects");
const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "..", "..", "tests", "fixtures", "claude-transcript-lines.jsonl");

function green(s) { return `\x1b[32m${s}\x1b[0m`; }
function red(s) { return `\x1b[31m${s}\x1b[0m`; }
function info(s) { console.log(`\x1b[36m[s1]\x1b[0m ${s}`); }

if (!existsSync(PROJECTS)) {
  console.log(red(`NULL: no ${PROJECTS} — no local transcripts to verify against`));
  process.exit(2);
}

// Walk projects/ recursively for *.jsonl (flat + nested layouts).
function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".jsonl")) out.push(p);
  }
  return out;
}

const files = walk(PROJECTS);
info(`found ${files.length} transcript files under ${PROJECTS}`);
if (files.length === 0) { console.log(red("NULL: no jsonl files")); process.exit(2); }

// Newest 40 files by mtime — representative of the current format version.
const recent = files
  .map((f) => ({ f, m: statSync(f).mtimeMs }))
  .sort((a, b) => b.m - a.m)
  .slice(0, 40)
  .map((x) => x.f);

let flat = 0, nested = 0;
for (const f of files.slice(0, 500)) (f.match(/\/[0-9a-f-]{36}\/[^/]+\.jsonl$/) ? nested++ : flat++);
info(`layout sample (first 500): flat=${flat} nested=${nested}`);

const need = {
  sessionId: 0, isSidechain: 0, requestId: 0,
  "message.id": 0, "message.model": 0, "message.usage": 0,
  "usage.input_tokens": 0, "usage.cache_read_input_tokens": 0,
  "usage.cache_creation_input_tokens": 0, "usage.output_tokens": 0,
};
let assistantEntries = 0, streamingIntermediates = 0, finalized = 0, badLines = 0, totalLines = 0;
const modelsSeen = new Set();
const msgIdBySession = new Map(); // sessionId -> Set(message.id) to check cross-session reuse
const fixtureLines = [];

for (const f of recent) {
  let raw;
  try { raw = readFileSync(f, "utf8"); } catch { continue; }
  const lines = raw.split("\n").filter(Boolean);
  for (const line of lines) {
    totalLines++;
    let o;
    try { o = JSON.parse(line); } catch { badLines++; continue; }
    if (typeof o.sessionId === "string") need.sessionId++;
    if (typeof o.isSidechain === "boolean") need.isSidechain++;
    if (typeof o.requestId === "string") need.requestId++;
    const m = o.message;
    if (m && typeof m === "object") {
      if (typeof m.id === "string") need["message.id"]++;
      if (typeof m.model === "string") { need["message.model"]++; modelsSeen.add(m.model); }
      if (m.usage && typeof m.usage === "object") {
        need["message.usage"]++;
        const u = m.usage;
        if (Number.isFinite(u.input_tokens)) need["usage.input_tokens"]++;
        if (Number.isFinite(u.cache_read_input_tokens)) need["usage.cache_read_input_tokens"]++;
        if (Number.isFinite(u.cache_creation_input_tokens)) need["usage.cache_creation_input_tokens"]++;
        if (Number.isFinite(u.output_tokens)) need["usage.output_tokens"]++;
      }
      if (o.type === "assistant") {
        assistantEntries++;
        const sr = m.stop_reason;
        if (sr === null || sr === undefined) streamingIntermediates++;
        else finalized++;
      }
      // cross-session message.id reuse check
      if (typeof o.sessionId === "string" && typeof m.id === "string") {
        if (!msgIdBySession.has(o.sessionId)) msgIdBySession.set(o.sessionId, new Set());
        msgIdBySession.get(o.sessionId).add(m.id);
      }
    }
  }
}

// Cross-session message.id reuse: does any message.id appear under >1 sessionId?
const idToSessions = new Map();
for (const [sid, ids] of msgIdBySession) for (const id of ids) {
  if (!idToSessions.has(id)) idToSessions.set(id, new Set());
  idToSessions.get(id).add(sid);
}
let reusedIds = 0;
for (const [, sids] of idToSessions) if (sids.size > 1) reusedIds++;

// Build scrubbed fixtures: pick a few representative assistant + user lines,
// replace human-text content with placeholders, keep structure + usage numbers.
function scrub(o) {
  const c = JSON.parse(JSON.stringify(o));
  const wipe = (msg) => {
    if (msg && Array.isArray(msg.content)) {
      for (const b of msg.content) {
        if (b && typeof b.text === "string") b.text = "Lorem ipsum.";
        if (b && typeof b.thinking === "string") b.thinking = "";
        if (b && typeof b.signature === "string") b.signature = "";
        if (b && typeof b.input === "object") b.input = { scrubbed: true };
        if (b && typeof b.content === "string") b.content = "scrubbed";
      }
    } else if (msg && typeof msg.content === "string") msg.content = "Lorem ipsum.";
  };
  if (c.message) wipe(c.message);
  if (typeof c.cwd === "string") c.cwd = "/scrubbed/cwd";
  if (typeof c.summary === "string") c.summary = "scrubbed summary";
  return c;
}
// grab up to: 1 finalized assistant, 1 streaming intermediate, 1 sidechain (if any), 1 user
const picks = { fin: null, mid: null, side: null, user: null };
outer: for (const f of recent) {
  let raw; try { raw = readFileSync(f, "utf8"); } catch { continue; }
  for (const line of raw.split("\n").filter(Boolean)) {
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o.type === "assistant" && o.message?.usage) {
      const sr = o.message.stop_reason;
      if (sr && !picks.fin) picks.fin = o;
      else if ((sr === null || sr === undefined) && !picks.mid) picks.mid = o;
      if (o.isSidechain === true && !picks.side) picks.side = o;
    }
    if (o.type === "user" && !picks.user) picks.user = o;
    if (picks.fin && picks.mid && picks.side && picks.user) break outer;
  }
}
for (const k of ["fin", "mid", "side", "user"]) if (picks[k]) fixtureLines.push(JSON.stringify(scrub(picks[k])));

if (fixtureLines.length >= 2 && !process.env.SPIKE_NO_FIXTURE) {
  mkdirSync(dirname(FIXTURE), { recursive: true });
  writeFileSync(FIXTURE, fixtureLines.join("\n") + "\n");
  info(`wrote ${fixtureLines.length} scrubbed fixture lines → ${FIXTURE}`);
}

console.log("\n--- field presence (recent 40 files) ---");
console.log(`total lines parsed: ${totalLines}, malformed: ${badLines}`);
console.log(`assistant entries: ${assistantEntries} (finalized=${finalized}, streaming-intermediate=${streamingIntermediates})`);
for (const [k, v] of Object.entries(need)) console.log(`  ${k}: ${v}`);
console.log(`models seen: ${[...modelsSeen].join(", ") || "(none)"}`);
console.log(`cross-session message.id reuse: ${reusedIds} ids appear under >1 session`);
console.log(`claude-code version under test: ${process.env.CLAUDE_VERSION || "run `claude --version` to log"}`);

// PASS criteria: the load-bearing fields must be present on a healthy share of
// assistant entries. usage + the four counters + model + sessionId are required.
const pass =
  need["message.usage"] > 0 &&
  need["usage.input_tokens"] > 0 &&
  need["usage.output_tokens"] > 0 &&
  need["usage.cache_read_input_tokens"] > 0 &&
  need["message.model"] > 0 &&
  need.sessionId > 0 &&
  need.isSidechain > 0 &&
  finalized > 0;

if (pass) {
  console.log(green("\nPASS: all D0-load-bearing fields present in real transcripts"));
  process.exit(0);
}
console.log(red("\nFAIL: one or more load-bearing fields missing — D0 'no' path (feature-flag off)"));
process.exit(1);
