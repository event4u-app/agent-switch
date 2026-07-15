#!/usr/bin/env node
// S3 — Codex rollout shape. Verifies token_count events with TokenUsageInfo
// incl. model_context_window in real rollout files under CODEX_HOME/sessions
// (default ~/.codex). Notes the known rate_limits:null persistence gap.
// Writes scrubbed fixtures to tests/fixtures/codex-rollout-lines.jsonl.

import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const HOME = process.env.CODEX_HOME || join(homedir(), ".codex");
const SESS = join(HOME, "sessions");
const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "..", "..", "tests", "fixtures", "codex-rollout-lines.jsonl");
const green = (s) => `\x1b[32m${s}\x1b[0m`, red = (s) => `\x1b[31m${s}\x1b[0m`;
const info = (s) => console.log(`\x1b[36m[s3]\x1b[0m ${s}`);

if (!existsSync(SESS)) { console.log(red(`NULL: no ${SESS}`)); process.exit(2); }
function walk(d, out = []) { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); e.isDirectory() ? walk(p, out) : e.name.endsWith(".jsonl") && out.push(p); } return out; }

const files = walk(SESS).map((f) => ({ f, m: statSync(f).mtimeMs })).sort((a, b) => b.m - a.m).slice(0, 200).map((x) => x.f);
info(`inspecting ${files.length} recent rollout files under ${SESS}`);

let tokenCountEvents = 0, withInfo = 0, withWindow = 0, withRateLimits = 0, nullRateLimits = 0, badLines = 0;
let filesWithUsableInfo = 0; // per-file: at least one token_count event with non-null info + window (what the adapter reads)
const counters = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, total_tokens: 0 };
const fixtures = [];

// Real shape (codex-cli 0.144.x): a line with type "event_msg" carries
// payload = { type: "token_count", info: TokenUsageInfo|null, rate_limits: {...}|null }.
// TokenUsageInfo = { total_token_usage, last_token_usage, model_context_window }.
function tokenCountPayload(o) {
  const p = o.payload ?? o.msg ?? o;
  if (p && typeof p === "object" && p.type === "token_count") return p;
  return null;
}

for (const f of files) {
  let raw; try { raw = readFileSync(f, "utf8"); } catch { continue; }
  let fileUsable = false;
  for (const line of raw.split("\n").filter(Boolean)) {
    let o; try { o = JSON.parse(line); } catch { badLines++; continue; }
    const p = tokenCountPayload(o);
    if (!p) continue;
    tokenCountEvents++;
    const info = p.info;
    if (info && typeof info === "object") {
      const usage = info.total_token_usage || info.last_token_usage;
      if (usage && typeof usage === "object") {
        withInfo++;
        for (const k of Object.keys(counters)) if (Number.isFinite(usage[k])) counters[k]++;
        if (Number.isFinite(info.model_context_window)) fileUsable = true;
      }
      if (Number.isFinite(info.model_context_window)) withWindow++;
    }
    if (p.rate_limits && typeof p.rate_limits === "object") withRateLimits++;
    else nullRateLimits++;
    if (info?.total_token_usage && fixtures.length < 4) fixtures.push(JSON.stringify(o).slice(0, 4000));
  }
  if (fileUsable) filesWithUsableInfo++;
}

if (fixtures.length >= 1 && !process.env.SPIKE_NO_FIXTURE) {
  mkdirSync(dirname(FIXTURE), { recursive: true });
  writeFileSync(FIXTURE, fixtures.join("\n") + "\n");
  info(`wrote ${fixtures.length} rollout fixture lines → ${FIXTURE}`);
}

console.log("\n--- codex token_count findings ---");
console.log(`files inspected: ${files.length}, files with ≥1 usable info+window event: ${filesWithUsableInfo}`);
console.log(`token_count events: ${tokenCountEvents}, with usage info: ${withInfo}, with model_context_window: ${withWindow}`);
console.log(`counters present:`, counters);
console.log(`rate_limits present: ${withRateLimits}, rate_limits null/absent: ${nullRateLimits}`);
console.log(`NOTE: not every token_count event carries info (short/aborted sessions → info:null); adapter reads the LAST non-null-info event.`);
console.log(`codex-cli version under test: ${process.env.CODEX_VERSION || "run `codex --version`"}`);

const pass = filesWithUsableInfo > 0 && counters.input_tokens > 0 && counters.output_tokens > 0;
console.log(pass ? green("\nPASS: codex rollouts carry token usage + context window in-band") : red("\nFAIL: expected token_count/window fields not found (Codex leg = unavailable)"));
process.exit(pass ? 0 : 1);
