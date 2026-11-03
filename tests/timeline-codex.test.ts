import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { fromCodexItem, fromCodexThread } from "../src/timeline/codex.js";

const FIX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../tests/fixtures/timeline");

test("codex thread: turns, the command, the file change as a diff, a failed turn with its reason", () => {
  const events = fromCodexThread(JSON.parse(fs.readFileSync(path.join(FIX, "codex-thread-0.166.0.json"), "utf8")));
  assert.deepEqual(events.map((e) => e.t), [
    "turn", "message", "thinking", "tool.started", "tool.finished", "tool.started", "diff", "tool.finished", "message", "unknown", "turn.end",
    "turn", "message", "tool.started", "tool.finished", "error", "turn.end",
  ]);
  const user = events[1] as { text: string; images: number };
  assert.deepEqual([user.text, user.images], ["rename foo to bar in util.ts", 1]);
  const diff = events.find((e) => e.t === "diff") as { path: string; added: number; removed: number };
  assert.deepEqual([diff.path, diff.added, diff.removed], ["util.ts", 1, 1]);
  const failedCmd = events.filter((e) => e.t === "tool.finished").at(-1) as { ok: boolean; summary: string };
  assert.deepEqual([failedCmd.ok, failedCmd.summary], [false, "1 failing"]);
  assert.deepEqual(events.at(-2), { t: "error", message: "usage limit reached" });
  assert.equal((events[0] as { at: string }).at, new Date(1793700000 * 1000).toISOString());
});

test("codex items: in-progress tools have no result yet; unknown items pass through", () => {
  assert.deepEqual(fromCodexItem({ type: "commandExecution", id: "c", command: "ls", status: "inProgress" }).map((e) => e.t), ["tool.started"]);
  assert.deepEqual(fromCodexItem({ type: "mcpToolCall", id: "m", server: "gh", tool: "search", arguments: { q: "x" }, status: "completed" }).map((e) => e.t), ["tool.started", "tool.finished"]);
  assert.deepEqual(fromCodexItem({ type: "brandNew", id: "n" }), [{ t: "unknown", kind: "codex:brandNew" }]);
  assert.deepEqual(fromCodexItem(null), [{ t: "unknown", kind: "codex:item" }]);
  assert.deepEqual(fromCodexThread({}), []);
});
