#!/usr/bin/env node
// S2 — context-math parity. Verifies the community-standard context-size
// formula is well-defined and produces sane values against real transcripts:
//   contextTokens = last FINALIZED MAIN-CHAIN assistant entry's
//     (input_tokens + cache_read_input_tokens + cache_creation_input_tokens)
//   output_tokens EXCLUDED (matches official statusline used_percentage).
//
// True ±2% parity needs a manual /context read-off in a live session; this
// spike proves the formula is deterministic, skips synthetics + sidechains +
// streaming intermediates, and yields 0 < contextTokens <= window for the model.
// Prints the top sessions so a human can cross-check one against /context.

import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const ROOT = process.env.CLAUDE_CONFIG_DIR?.split(",")[0] || join(homedir(), ".claude");
const PROJECTS = join(ROOT, "projects");
const WINDOW = { "claude-opus-4-8": 1_000_000, "claude-fable-5": 1_000_000, "claude-sonnet-4-5": 200_000, "claude-opus-4-5": 200_000, "claude-haiku-4-5": 200_000 };
const green = (s) => `\x1b[32m${s}\x1b[0m`, red = (s) => `\x1b[31m${s}\x1b[0m`;

if (!existsSync(PROJECTS)) { console.log(red("NULL: no projects dir")); process.exit(2); }

function walk(d, out = []) { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); e.isDirectory() ? walk(p, out) : e.name.endsWith(".jsonl") && out.push(p); } return out; }

// last finalized main-chain assistant entry (walk backwards)
function lastContext(file) {
  let raw; try { raw = readFileSync(file, "utf8"); } catch { return null; }
  const lines = raw.split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    let o; try { o = JSON.parse(lines[i]); } catch { continue; }
    if (o.type !== "assistant" || o.isSidechain === true) continue;
    const m = o.message; if (!m?.usage) continue;
    if (m.model === "<synthetic>") continue;
    const sr = m.stop_reason; if (sr === null || sr === undefined) continue; // streaming intermediate
    const u = m.usage;
    const inputSide = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    return { inputSide, output: u.output_tokens || 0, model: m.model, ts: o.timestamp };
  }
  return null;
}

const files = walk(PROJECTS).map((f) => ({ f, m: statSync(f).mtimeMs })).sort((a, b) => b.m - a.m).slice(0, 60).map((x) => x.f);
let ok = 0, overWindow = 0, nullCtx = 0;
const rows = [];
for (const f of files) {
  const c = lastContext(f);
  if (!c) { nullCtx++; continue; }
  const win = WINDOW[c.model] ?? null;
  const pct = win ? Math.round((c.inputSide / win) * 1000) / 10 : null;
  if (win && c.inputSide > win) overWindow++;
  if (c.inputSide > 0) ok++;
  rows.push({ f: f.split("/").slice(-2).join("/"), ...c, win, pct });
}
rows.sort((a, b) => (b.inputSide || 0) - (a.inputSide || 0));
console.log("--- top 10 live-context computations (cross-check one vs /context) ---");
for (const r of rows.slice(0, 10)) console.log(`  ${r.pct ?? "?"}%\t${r.inputSide}/${r.win ?? "?"}\t${r.model}\t${r.f}`);
console.log(`\nsessions with defined context: ${ok}, null (no finalized main-chain): ${nullCtx}, OVER window: ${overWindow}`);

const pass = ok > 0 && overWindow === 0;
console.log(pass ? green("\nPASS: formula deterministic, all values within window") : red("\nFAIL: context exceeded window or no computable sessions"));
process.exit(pass ? 0 : 1);
