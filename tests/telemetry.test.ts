import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  contextWindowFor,
  tailLines,
  readClaudeContext,
  readCodexContext,
  readContext,
  sessionContext,
  claudeTranscriptPath,
  preflightClaude,
  turnInFlight,
  CONTEXT_WINDOWS,
  SUPPORTED_CLAUDE,
} from "../src/telemetry.js";

// The adapter is the SINGLE sanctioned transcript reader. These tests drive the
// pure parse mechanics on (a) synthetic lines shaped like the verified real
// format and (b) the scrubbed fixtures committed by scripts/spikes/t1+t3.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX_CLAUDE = path.join(HERE, "fixtures", "claude-transcript-lines.jsonl");
const FIX_CODEX = path.join(HERE, "fixtures", "codex-rollout-lines.jsonl");

function tmpFile(lines: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asw-telem-"));
  const f = path.join(dir, "t.jsonl");
  fs.writeFileSync(f, lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n") + "\n");
  return f;
}

function asst(usage: Record<string, number>, opts: { model?: string; stop?: string | null; sidechain?: boolean; ts?: string } = {}): string {
  const stop_reason = "stop" in opts ? opts.stop : "end_turn"; // null must stay null (streaming intermediate)
  return JSON.stringify({
    type: "assistant",
    isSidechain: opts.sidechain ?? false,
    sessionId: "s1",
    timestamp: opts.ts ?? "2026-07-15T00:00:00Z",
    message: { id: "m", model: opts.model ?? "claude-opus-4-8", stop_reason, usage },
  });
}

// ---------- contextWindowFor ----------

test("contextWindowFor: known models, override, unknown → null", () => {
  assert.equal(contextWindowFor("claude-opus-4-8"), 1_000_000);
  assert.equal(contextWindowFor("claude-sonnet-4-5"), 200_000);
  assert.equal(contextWindowFor("some-future-model"), null);
  assert.equal(contextWindowFor(null), null);
  assert.equal(contextWindowFor("some-future-model", { "some-future-model": 500_000 }), 500_000);
  // override wins even over a known model
  assert.equal(contextWindowFor("claude-opus-4-8", { "claude-opus-4-8": 42 }), 42);
});

// ---------- readClaudeContext: the core formula ----------

test("readClaudeContext: sums input side, excludes output, computes pct", () => {
  const f = tmpFile([
    asst({ input_tokens: 100, cache_read_input_tokens: 50, cache_creation_input_tokens: 25, output_tokens: 999 }),
  ]);
  const r = readClaudeContext(f, { claudeVersion: "2.1.210" })!;
  assert.equal(r.contextTokens, 175); // 100+50+25, output excluded
  assert.equal(r.windowTokens, 1_000_000);
  assert.equal(r.pct, 0); // 175/1e6 rounded to 0.0
  assert.equal(r.model, "claude-opus-4-8");
  assert.equal(r.confidence, "high");
});

test("readClaudeContext: picks the LAST finalized main-chain entry", () => {
  const f = tmpFile([
    asst({ input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0 }, { ts: "a" }),
    asst({ input_tokens: 900_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0 }, { ts: "b" }),
  ]);
  const r = readClaudeContext(f, { claudeVersion: "2.1.210" })!;
  assert.equal(r.contextTokens, 900_000);
  assert.equal(r.pct, 90);
  assert.equal(r.timestamp, "b");
});

test("readClaudeContext: skips sidechain, synthetic, and streaming intermediates", () => {
  const f = tmpFile([
    asst({ input_tokens: 500_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0 }, { ts: "real" }),
    asst({ input_tokens: 999_999, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0 }, { sidechain: true }),
    asst({ input_tokens: 999_999, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0 }, { model: "<synthetic>" }),
    asst({ input_tokens: 999_999, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0 }, { stop: null }),
  ]);
  const r = readClaudeContext(f, { claudeVersion: "2.1.210" })!;
  // the sidechain/synthetic/streaming entries are newer but must be skipped
  assert.equal(r.contextTokens, 500_000);
  assert.equal(r.timestamp, "real");
});

test("readClaudeContext: unknown model → tokens without pct", () => {
  const f = tmpFile([
    asst({ input_tokens: 1234, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0 }, { model: "claude-future-9" }),
  ]);
  const r = readClaudeContext(f, { claudeVersion: "2.1.210" })!;
  assert.equal(r.contextTokens, 1234);
  assert.equal(r.windowTokens, null);
  assert.equal(r.pct, null);
});

test("readClaudeContext: no usable entry → null (degraded, never throws)", () => {
  const f = tmpFile([JSON.stringify({ type: "user", message: { content: "hi" } })]);
  assert.equal(readClaudeContext(f, { claudeVersion: "2.1.210" }), null);
  assert.equal(readClaudeContext("/no/such/file.jsonl"), null);
});

test("readClaudeContext: malformed lines are tolerated but lower confidence", () => {
  const f = tmpFile([
    "{ not json",
    "also } not json",
    asst({ input_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0 }),
  ]);
  const r = readClaudeContext(f, { claudeVersion: "2.1.210" })!;
  assert.equal(r.contextTokens, 100);
  assert.equal(r.confidence, "low"); // 2/3 malformed
});

test("readClaudeContext: unsupported version → low confidence even on clean parse", () => {
  const f = tmpFile([asst({ input_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0 })]);
  const r = readClaudeContext(f, { claudeVersion: "9.9.9" })!;
  assert.equal(r.confidence, "low");
});

// ---------- readCodexContext ----------

test("readCodexContext: reads last non-null-info token_count, in-band window", () => {
  const tc = (info: any, ts: string) => JSON.stringify({ type: "event_msg", timestamp: ts, payload: { type: "token_count", info } });
  const f = tmpFile([
    tc({ total_token_usage: { total_tokens: 1000 }, model_context_window: 258400 }, "old"),
    tc(null, "aborted"), // info:null — must be skipped
  ]);
  const r = readCodexContext(f)!;
  assert.equal(r.provider, "codex");
  assert.equal(r.contextTokens, 1000);
  assert.equal(r.windowTokens, 258400);
  assert.equal(r.timestamp, "old"); // the non-null-info one
});

// ---------- fixtures (real scrubbed shapes from the spikes) ----------

test("fixtures: real scrubbed claude lines parse into a reading", () => {
  if (!fs.existsSync(FIX_CLAUDE)) return; // fixtures optional in a fresh clone until t1 runs
  const r = readClaudeContext(FIX_CLAUDE, { claudeVersion: "2.1.210" });
  assert.ok(r, "expected a reading from the claude fixture");
  assert.ok(r!.contextTokens > 0, "fixture reading should have context tokens");
  assert.ok(r!.model && r!.model.startsWith("claude-"), "fixture model should be a claude model");
});

test("fixtures: real scrubbed codex lines parse into a reading", () => {
  if (!fs.existsSync(FIX_CODEX)) return;
  const r = readCodexContext(FIX_CODEX);
  assert.ok(r, "expected a reading from the codex fixture");
  assert.ok(r!.contextTokens > 0);
  assert.ok(r!.windowTokens && r!.windowTokens > 0, "codex window is in-band");
});

// ---------- readContext dispatch + preflight ----------

test("readContext dispatches by provider", () => {
  const f = tmpFile([asst({ input_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0 })]);
  assert.equal(readContext("claude", f, { claudeVersion: "2.1.210" })!.provider, "claude");
});

test("sessionContext joins provider + file into a reading", () => {
  const f = tmpFile([asst({ input_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0 })]);
  const r = sessionContext({ provider: "claude", file: f }, { claudeVersion: "2.1.210" })!;
  assert.equal(r.contextTokens, 200);
});

test("claudeTranscriptPath builds the on-disk path", () => {
  assert.equal(
    claudeTranscriptPath("/cfg", "-Users-me-proj", "abc-123"),
    "/cfg/projects/-Users-me-proj/abc-123.jsonl",
  );
});

test("preflightClaude: ok on supported version, degraded otherwise", () => {
  const f = tmpFile([asst({ input_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0 })]);
  const good = preflightClaude(f, "2.1.210");
  assert.equal(good.ok, true);
  assert.equal(good.confidence, "high");

  const drift = preflightClaude(f, "9.9.9");
  assert.equal(drift.ok, true);
  assert.equal(drift.confidence, "low");

  const empty = tmpFile([JSON.stringify({ type: "user" })]);
  const bad = preflightClaude(empty, "2.1.210");
  assert.equal(bad.ok, false);
});

test("tailLines: drops the partial first line when capped", () => {
  const f = tmpFile(["AAAA", "BBBB", "CCCC"]);
  const capped = tailLines(f, 10); // only the tail fits → first line partial, dropped
  assert.ok(!capped.includes("AAAA"));
  assert.ok(capped.includes("CCCC"));
});

test("invariant: SUPPORTED_CLAUDE and CONTEXT_WINDOWS are non-empty", () => {
  assert.ok(SUPPORTED_CLAUDE.length > 0);
  assert.ok(Object.keys(CONTEXT_WINDOWS).length > 0);
});

test("turnInFlight: true only for a recent non-finalized last assistant entry", () => {
  const now = 1_000_000;
  // non-finalized + recent → in flight
  const running = tmpFile([asst({ input_tokens: 1 }, { stop: null, ts: new Date(now - 2000).toISOString() })]);
  assert.equal(turnInFlight(running, now, 15_000), true);
  // non-finalized but stale (older than the guard window) → not blocking
  const stale = tmpFile([asst({ input_tokens: 1 }, { stop: null, ts: new Date(now - 60_000).toISOString() })]);
  assert.equal(turnInFlight(stale, now, 15_000), false);
  // finalized last entry → not in flight
  const done = tmpFile([asst({ input_tokens: 1 }, { stop: "end_turn", ts: new Date(now - 1000).toISOString() })]);
  assert.equal(turnInFlight(done, now, 15_000), false);
  // last line is a user entry → not in flight
  const user = tmpFile([asst({ input_tokens: 1 }, { stop: "end_turn" }), JSON.stringify({ type: "user", message: { content: "hi" } })]);
  assert.equal(turnInFlight(user, now, 15_000), false);
  // unreadable → false (never block on a missing file)
  assert.equal(turnInFlight("/no/such.jsonl", now, 15_000), false);
});

test("perf: reading context from a large transcript stays cheap (capped tail)", () => {
  // A big transcript (~5 MB) with the real entry at the very end. The capped
  // tail read means cost is bounded by TAIL_CAP, not file size — the daemon's
  // <100ms/cycle budget rests on this.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asw-perf-"));
  const f = path.join(dir, "big.jsonl");
  const filler = JSON.stringify({ type: "user", message: { content: "x".repeat(400) } }) + "\n";
  const body = filler.repeat(12000) + asst({ input_tokens: 500_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0 }) + "\n";
  fs.writeFileSync(f, body); // ~5 MB, real entry last
  const t0 = process.hrtime.bigint();
  const r = readClaudeContext(f, { claudeVersion: "2.1.210" })!;
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.equal(r.contextTokens, 500_000, "finds the real entry in the capped tail");
  // 20 such reads must fit well under the 100ms/cycle budget → single read < 20ms
  assert.ok(ms < 20, `single capped read should be <20ms, was ${ms.toFixed(1)}ms`);
});
