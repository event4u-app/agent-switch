import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { lineageFromEnv, clearedFrom, pidFrom } from "../src/hooks.js";
import { helperIndex, childrenWithHooks, countSubagentFiles, childSource, buildTree, relationUnknown } from "../src/lineage.js";

const SID = "3c87a281-1424-4ebf-965d-7ee64ed28e82";
const PARENT = "claude/work/0ba6a24b-ebfa-4619-924e-30006a77f6dc";

test("lineageFromEnv: the contract's vars, checked; kind from the allowlist; label cleaned", () => {
  assert.deepEqual(lineageFromEnv({ AGENT_SWITCH_PARENT_SESSION: PARENT, AGENT_SWITCH_PARENT_KIND: "council", AGENT_SWITCH_PARENT_LABEL: "seat 2\nof 3", AGENT_SWITCH_PARENT_AGENT: "claude" }, SID), {
    parent: PARENT,
    kind: "council",
    label: "seat 2 of 3",
    agent: "claude",
    source: "lineage",
  });
  assert.equal(lineageFromEnv({ AGENT_SWITCH_PARENT_SESSION: PARENT, AGENT_SWITCH_PARENT_KIND: "boss" }, SID)!.kind, "other");
  assert.equal(lineageFromEnv({ AGENT_SWITCH_PARENT_SESSION: "../../etc" }, SID), undefined, "malformed: dropped, not guessed");
  assert.equal(lineageFromEnv({ AGENT_SWITCH_PARENT_SESSION: `claude/work/${SID}` }, SID), undefined, "a session is not its own parent");
  assert.equal(lineageFromEnv({ AGENT_SWITCH_PARENT_LABEL: "x".repeat(300), AGENT_SWITCH_PARENT_SESSION: SID.replace("3c", "4d") }, SID)!.label!.length, 80);
});

test("lineageFromEnv: inside an AS-hosted window, the window's session is the parent — not for that session itself", () => {
  assert.deepEqual(lineageFromEnv({ AGENT_SWITCH_HOST_PANE: PARENT }, SID), { parent: PARENT, kind: "started_by", source: "host" });
  assert.equal(lineageFromEnv({ AGENT_SWITCH_HOST_PANE: PARENT }, PARENT.split("/")[2]), undefined, "the hosted session's own start");
  assert.equal(lineageFromEnv({ AGENT_SWITCH_HOST_PANE: "1" }, SID), undefined, "the 2.x value is not a key");
  assert.equal(lineageFromEnv({}, SID), undefined);
});

test("helpers across accounts: a bare parent id and a full key both find the parent; a parent's end ends nothing of theirs", () => {
  const at = "2026-11-02T10:00:00Z";
  const events = new Map([
    ["work", [{ event: "SubagentStart", sessionId: "0ba6a24b-ebfa-4619-924e-30006a77f6dc", agentId: "a1", agentType: "Explore", at }]],
    [
      "side",
      [
        { event: "SessionStart", sessionId: "11111111-aaaa", lineage: { parent: PARENT, kind: "council" as const, label: "seat 1", source: "lineage" as const }, at },
        { event: "SessionStart", sessionId: "22222222-bbbb", lineage: { parent: "0ba6a24b-ebfa-4619-924e-30006a77f6dc", kind: "council" as const, source: "lineage" as const }, at },
        { event: "SessionEnd", sessionId: "22222222-bbbb", at },
      ],
    ],
  ]);
  const idx = helperIndex("claude", events);
  const kids = childrenWithHooks(PARENT, events.get("work")!, idx);
  assert.deepEqual(kids.map((k) => [k.kind, "sessionKey" in k ? k.sessionKey : k.agentId, k.state, k.source]), [
    ["subagent", "a1", "running", "hook"],
    ["council", "claude/side/11111111-aaaa", "running", "lineage"],
    ["council", "claude/side/22222222-bbbb", "done", "lineage"],
  ]);
  assert.equal(childSource(kids), "hook+lineage");
  assert.equal(idx.parentOf.get("claude/side/11111111-aaaa"), PARENT);
});

test("countSubagentFiles counts names only, never opens them", () => {
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), "asw-lin-"));
  const dir = path.join(cfg, "projects", "-repo", SID, "subagents");
  fs.mkdirSync(dir, { recursive: true });
  for (const n of ["agent-a1.jsonl", "agent-a2.jsonl", "notes.txt"]) fs.writeFileSync(path.join(dir, n), "");
  fs.chmodSync(path.join(dir, "agent-a1.jsonl"), 0o000); // unreadable is fine: it is only counted
  assert.equal(countSubagentFiles(cfg, "-repo", SID), 2);
  assert.equal(countSubagentFiles(cfg, "-repo", "other"), 0);
});

test("buildTree: every row appears once, children under their listed parent, no cycles (seeded)", () => {
  let seed = 7;
  const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
  for (let round = 0; round < 50; round++) {
    const n = 2 + rnd(12);
    const keys = Array.from({ length: n }, (_, i) => `claude/a/s${i}`);
    // Random parents, including cycles, self-parents, unknown and bare ids.
    const parent = new Map(keys.map((k) => [k, [undefined, keys[rnd(n)], `s${rnd(n)}`, "claude/a/missing"][rnd(4)]]));
    const tree = buildTree(keys, (k) => k, (k) => parent.get(k));
    const seen: string[] = [];
    const walk = (nodes: typeof tree, ancestors: string[]) => {
      for (const node of nodes) {
        assert.ok(!ancestors.includes(node.row), `cycle at ${node.row}`);
        seen.push(node.row);
        walk(node.children, [...ancestors, node.row]);
      }
    };
    walk(tree, []);
    assert.deepEqual([...seen].sort(), [...keys].sort(), `round ${round}: each row exactly once`);
  }
});

test("a takeover's resumed session reports where it came from, even with the same id", () => {
  const env = { AGENT_SWITCH_PARENT_SESSION: `claude/work/${SID}`, AGENT_SWITCH_PARENT_KIND: "continued_from" };
  assert.deepEqual(lineageFromEnv(env, SID, `claude/side/${SID}`), { parent: `claude/work/${SID}`, kind: "continued_from", source: "host" });
  assert.equal(lineageFromEnv(env, SID, `claude/work/${SID}`), undefined, "the same key is the session itself");
});

test("relationUnknown: an unclaimed session in a temp folder is marked, never attached", () => {
  const roots = ["/tmp", "/var/folders"];
  assert.equal(relationUnknown("/var/folders/x/T/seat", false, roots), true);
  assert.equal(relationUnknown("/tmp", false, roots), true);
  assert.equal(relationUnknown("/tmpfoo/repo", false, roots), false, "a prefix of a name is not the folder");
  assert.equal(relationUnknown("/var/folders/x", true, roots), false, "a reported parent wins");
  assert.equal(relationUnknown(null, false, roots), false);
});

test("clearedFrom: a /clear links to the last session of the same Claude process, and nothing else does", () => {
  const at = "2026-11-02T10:00:00Z";
  const ring = [
    { event: "SessionStart", source: "startup", sessionId: "A", hostPid: 4242, at },
    { event: "SessionStart", source: "startup", sessionId: "X", hostPid: 7, at },
    { event: "SessionEnd", sessionId: "A", at },
  ];
  assert.equal(clearedFrom({ event: "SessionStart", source: "clear", sessionId: "B", hostPid: 4242, at }, ring), "A");
  assert.equal(clearedFrom({ event: "SessionStart", source: "startup", sessionId: "B", hostPid: 4242, at }, ring), undefined, "a new start is not a clear");
  assert.equal(clearedFrom({ event: "SessionStart", source: "clear", sessionId: "B", at }, ring), undefined, "no pid, no edge");
  assert.equal(clearedFrom({ event: "SessionStart", source: "clear", sessionId: "B", hostPid: 1, at }, ring), undefined, "another process");
  assert.equal(pidFrom("4242"), 4242);
  assert.equal(pidFrom("0"), undefined);
  assert.equal(pidFrom("12; rm"), undefined);
});
