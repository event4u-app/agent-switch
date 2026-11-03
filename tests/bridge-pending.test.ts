import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { clearPending, pendingDir, readPending, writePending } from "../src/bridge/pending.js";
import { bridgeCandidates } from "../src/commands/needs.js";
import { matchFiles } from "../src/commands/bridge.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "asw-pend-"));

test("pending: written per bridge, read while the bridge lives, removed when it is gone or empty", () => {
  const root = tmp();
  writePending(root, { key: "claude/w/s1", pid: process.pid, items: [{ id: "r1", tool: "Bash", summary: "npm test", since: "2026-11-03T00:00:00Z" }] });
  writePending(root, { key: "claude/w/s2", pid: 999_999_999, items: [{ id: "r2", tool: "Write", summary: "a.txt", since: "2026-11-03T00:00:00Z" }] });
  assert.deepEqual(readPending(root).map((f) => f.key), ["claude/w/s1"]);
  assert.equal(fs.readdirSync(pendingDir(root)).length, 1, "the dead bridge's file is removed");
  writePending(root, { key: "claude/w/s1", pid: process.pid, items: [] });
  assert.deepEqual(readPending(root), [], "no open items, no file");
  writePending(root, { key: "claude/w/s1", pid: process.pid, items: [{ id: "r3", tool: "Bash", summary: "", since: "x" }] });
  clearPending(root, "claude/w/s1");
  assert.deepEqual(readPending(root), []);
  assert.deepEqual(readPending(path.join(root, "nowhere")), []);
  fs.writeFileSync(path.join(pendingDir(root), "junk.json"), "{nope");
  assert.deepEqual(readPending(root), [], "a broken file is skipped");
});

test("Needs-you: a chat's approval and question, one item each, opening the chat", () => {
  const c = bridgeCandidates([{ key: "claude/w/s1", pid: 1, items: [{ id: "r1", tool: "Bash", summary: "npm test", since: "t1" }, { id: "q1", tool: "AskUserQuestion", summary: "", since: "t2" }] }]);
  assert.deepEqual(c, [
    { kind: "approval", subject: "claude/w/s1", who: "Bash · npm test", what: "wants your approval in the chat", since: "t1", version: "r1", verb: "Open chat" },
    { kind: "question", subject: "claude/w/s1", who: "AskUserQuestion", what: "asks you in the chat", since: "t2", version: "q1", verb: "Open chat" },
  ]);
});

test("matchFiles: every word, names first, shorter first, capped", () => {
  const all = ["src/store/store.ts", "src/a/b/store-test/x.ts", "docs/store.md", "src/engine/server.ts", "README.md"];
  assert.deepEqual(matchFiles(all, "store"), ["docs/store.md", "src/store/store.ts", "src/a/b/store-test/x.ts"]);
  assert.deepEqual(matchFiles(all, "src ts server"), ["src/engine/server.ts"]);
  assert.equal(matchFiles(all, "").length, 5);
  assert.equal(matchFiles(Array.from({ length: 80 }, (_, i) => `f${i}`), "f").length, 50);
});
