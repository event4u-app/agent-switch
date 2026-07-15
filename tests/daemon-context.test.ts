import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

process.env.AGENT_SWITCH_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "asw-dctx-"));
const ROOT = process.env.AGENT_SWITCH_HOME;
const D = await import("../src/daemon.js");
const S = await import("../src/sessions.js");
const N = await import("../src/notify.js");

const WIN = process.platform === "win32";

/** Seed a claude profile with one transcript whose last finalized main-chain
 *  assistant entry reports `inputTokens` of context. */
function seedProfile(name: string, encDir: string, id: string, inputTokens: number): void {
  const dir = path.join(ROOT, "claude", name, "config", "projects", encDir);
  fs.mkdirSync(dir, { recursive: true });
  const line = JSON.stringify({
    type: "assistant",
    isSidechain: false,
    sessionId: id,
    timestamp: new Date().toISOString(),
    message: { id: "m", model: "claude-opus-4-8", stop_reason: "end_turn", usage: { input_tokens: inputTokens, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 5 } },
  });
  fs.writeFileSync(path.join(dir, `${id}.jsonl`), line + "\n");
}

/** Mark this test process as a live session in the profile, so markLive picks
 *  the transcript up (uses the real pidCwd of our own pid). */
function fakeLive(name: string): string {
  const cfg = path.join(ROOT, "claude", name, "config");
  fs.mkdirSync(path.join(cfg, "sessions"), { recursive: true });
  fs.writeFileSync(path.join(cfg, "sessions", `${process.pid}.json`), "{}");
  const realCwd = S.pidCwd(process.pid) ?? process.cwd();
  return S.encodeProjectDir(realCwd);
}

test("monitorContext snapshots a live session's own context and fires a threshold crossing", { skip: WIN }, () => {
  const enc = fakeLive("work");
  // 900k / 1M window (opus-4-8) = 90% → crosses the 80 threshold
  seedProfile("work", enc, "live-1", 900_000);

  const state: any = { lastPoll: null, pollIntervalMs: 60000, profiles: {}, lastError: null };
  const logs: string[] = [];
  D.monitorContext("claude", "work", state, (l) => logs.push(l));

  const snaps = state.sessionContext?.["claude/work"];
  assert.ok(Array.isArray(snaps) && snaps.length >= 1, "a live session context snapshot was recorded");
  const mine = snaps.find((s: any) => s.sessionId === "live-1");
  assert.ok(mine, "our seeded live session is present");
  assert.equal(mine.pct, 90);
  assert.equal(mine.windowTokens, 1_000_000);

  // an 80% crossing was logged; fired-state persisted so it won't re-fire
  assert.ok(logs.some((l) => /context: claude\/work .* crossed 80%/.test(l)), `expected an 80% crossing log, got: ${logs.join(" | ")}`);
  const fired = state.contextThresholds?.["claude/work"]?.["live-1"]?.fired ?? [];
  assert.ok(fired.includes(80), "80 recorded as fired");

  // second pass, same context → no re-fire
  const logs2: string[] = [];
  D.monitorContext("claude", "work", state, (l) => logs2.push(l));
  assert.ok(!logs2.some((l) => /crossed 80%/.test(l)), "no re-fire at the same context level");
});

test("monitorContext degrades cleanly when the profile has no live sessions", { skip: WIN }, () => {
  const state: any = { lastPoll: null, pollIntervalMs: 60000, profiles: {}, lastError: null };
  D.monitorContext("claude", "empty", state, () => {});
  // no throw; an (empty) snapshot list for the key
  assert.deepEqual(state.sessionContext?.["claude/empty"] ?? [], []);
});
