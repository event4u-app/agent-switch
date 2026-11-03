import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { Store, importEventRings, checkRecord, IngestRejected, sessionKey, storeFile, STORE_SCHEMA_VERSION } from "../src/store/store.js";
import { openDriver, StoreUnavailable } from "../src/store/driver.js";

// The store needs node:sqlite (Node ≥ 22.13) or Bun. CI also runs Node 20,
// where the engine keeps its JSON files; these tests say so instead of passing.
const probe = await openDriver(":memory:").then(
  (d) => (d.close(), null),
  (e) => (e instanceof StoreUnavailable ? e.message : (() => { throw e; })()),
);
const gate = { skip: probe ?? false };

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "asw-store-"));
const at = (n: number) => new Date(Date.UTC(2026, 10, 2, 10, 0, n)).toISOString();
const rec = (event: string, sessionId: string | undefined, n: number, extra: Record<string, unknown> = {}) => ({ event, ...(sessionId ? { sessionId } : {}), at: at(n), ...extra });

test("checkRecord keeps the allowlisted fields only — no prompt or answer text survives", () => {
  const c = checkRecord({
    producer: "p",
    seq: 1,
    provider: "claude",
    account: "work",
    record: { event: "SubagentStop", sessionId: "s1", at: at(0), agentId: "a1", agentType: "general-purpose", cwd: "/repo", last_assistant_message: "secret", prompt: "secret", transcript_path: "/x", error: "e".repeat(2000) },
  });
  assert.equal(c.kind, "SubagentStop");
  assert.equal(c.session, "s1");
  assert.deepEqual(Object.keys(c.data).sort(), ["agentId", "agentType", "cwd", "error"]);
  assert.equal((c.data.error as string).length, 512, "free strings are capped");
  assert.ok(!JSON.stringify(c).includes("secret"));
});

test("checkRecord rejects what it cannot place", () => {
  const base = { producer: "p", seq: 1, provider: "claude", account: "work" };
  for (const bad of [
    { ...base, record: { at: at(0) } },
    { ...base, record: { event: "Stop", at: "yesterday" } },
    { ...base, record: { event: "Stop; DROP TABLE", at: at(0) } },
    { ...base, account: "a/b", record: { event: "Stop", at: at(0) } },
    { ...base, provider: "../x", record: { event: "Stop", at: at(0) } },
    { ...base, producer: "", record: { event: "Stop", at: at(0) } },
  ]) assert.throws(() => checkRecord(bad as any), IngestRejected);
});

test("ingest is append-only and dedupes on (producer, seq)", gate, async () => {
  const store = await Store.open(storeFile(tmp()));
  try {
    const input = { producer: "hook:claude-work", seq: 7, provider: "claude", account: "work", record: rec("Stop", "s1", 0) };
    assert.equal(store.ingest(input), true);
    assert.equal(store.ingest(input), false, "same producer and seq: stored once");
    assert.equal(store.ingest({ ...input, producer: "hook:claude-other" }), true, "another producer may reuse the seq");
    assert.equal(store.eventCount(), 2);
  } finally {
    store.close();
  }
});

test("projections: sessions per account, subagents as proven hook edges, ended with their parent", gate, async () => {
  const store = await Store.open(storeFile(tmp()));
  try {
    let seq = 0;
    const put = (account: string, r: Record<string, unknown>) => store.ingest({ producer: "t", seq: seq++, provider: "claude", account, record: r });
    put("work", rec("SessionStart", "s1", 0, { source: "startup" }));
    put("work", rec("SubagentStart", "s1", 1, { agentId: "a1", agentType: "general-purpose", cwd: "/r/.claude/worktrees/agent-a1" }));
    put("work", rec("SubagentStart", "s1", 2, { agentId: "a2", agentType: "Explore" }));
    put("work", rec("SubagentStop", "s1", 3, { agentId: "a1" }));
    put("side", rec("SessionStart", "s1", 4)); // same id, other account: another session (ADR-007)

    const keys = store.sessions().map((s) => s.key).sort();
    assert.deepEqual(keys, [sessionKey("claude", "side", "s1"), sessionKey("claude", "work", "s1")]);
    const kids = store.children(sessionKey("claude", "work", "s1"));
    assert.deepEqual(kids.map((k) => [k.child.split("#")[1], k.state, k.source, k.confidence]), [["a1", "done", "hook", "proven"], ["a2", "running", "hook", "proven"]]);
    assert.equal(kids[0].cwd, "/r/.claude/worktrees/agent-a1", "the start's cwd survives a stop without one");
    assert.deepEqual(store.children(sessionKey("claude", "side", "s1")), []);

    put("work", rec("SessionEnd", "s1", 5));
    assert.ok(store.children(sessionKey("claude", "work", "s1")).every((k) => k.state === "done"));
    assert.equal(store.sessions().find((s) => s.account === "work")!.ended, true);
  } finally {
    store.close();
  }
});

test("rebuildProjections reproduces the incremental projections for any event order (seeded)", gate, async () => {
  let seed = 42;
  const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
  for (let round = 0; round < 20; round++) {
    const store = await Store.open(storeFile(tmp()));
    try {
      const kinds = ["SessionStart", "Stop", "SubagentStart", "SubagentStop", "SessionEnd", "Notification"];
      for (let i = 0; i < 60; i++) {
        const kind = kinds[rnd(kinds.length)];
        store.ingest({
          producer: `p${rnd(3)}`,
          seq: i,
          provider: "claude",
          account: ["work", "side"][rnd(2)],
          record: rec(kind, `s${rnd(4)}`, i, kind.startsWith("Subagent") ? { agentId: `a${rnd(5)}`, agentType: "general-purpose" } : {}),
        });
      }
      const snapshot = () => ({ sessions: store.sessions(), kids: store.sessions().map((s) => store.children(s.key)) });
      const before = snapshot();
      store.rebuildProjections();
      assert.deepEqual(snapshot(), before, `round ${round}`);
      // Every child has exactly one parent and no child is its own ancestor.
      for (const s of before.sessions) for (const k of store.children(s.key)) assert.notEqual(k.child, k.parent);
    } finally {
      store.close();
    }
  }
});

test("importEventRings brings the 2.x rings in once, oldest generation first, and leaves them as they were", gate, async () => {
  const root = tmp();
  const ev = path.join(root, "events");
  fs.mkdirSync(ev);
  const line = (r: object) => JSON.stringify(r) + "\n";
  const pinned = line(rec("Notification", "s0", 0));
  fs.writeFileSync(path.join(ev, "claude-work.jsonl.pin"), pinned);
  fs.writeFileSync(path.join(ev, "claude-work.jsonl.1"), pinned + line(rec("Stop", "s1", 1)));
  fs.writeFileSync(path.join(ev, "claude-work.jsonl"), line(rec("SubagentStart", "s1", 2, { agentId: "a1" })) + "not json\n");
  fs.writeFileSync(path.join(ev, "claude-my-side.jsonl"), line(rec("SessionStart", "s9", 3)));
  const rings = Object.fromEntries(fs.readdirSync(ev).map((n) => [n, fs.readFileSync(path.join(ev, n), "utf8")]));

  const store = await Store.open(storeFile(root));
  try {
    const first = importEventRings(store, root);
    assert.deepEqual(first, { files: 4, read: 6, stored: 4, rejected: 1 }, "the line in both .pin and .1 is stored once");
    assert.deepEqual(importEventRings(store, root).stored, 0, "a second import stores nothing");
    assert.deepEqual(store.sessions().map((s) => s.key).sort(), ["claude/my-side/s9", "claude/work/s0", "claude/work/s1"], "an account name with a dash survives");
    assert.equal(store.children("claude/work/s1").length, 1);
  } finally {
    store.close();
  }
  for (const [n, c] of Object.entries(rings)) assert.equal(fs.readFileSync(path.join(ev, n), "utf8"), c, `${n} unchanged`);
});

test("the store file is private and refuses a newer schema", gate, async () => {
  const file = storeFile(tmp());
  const store = await Store.open(file);
  store.close();
  if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const d = await openDriver(file);
  d.exec(`PRAGMA user_version = ${STORE_SCHEMA_VERSION + 1}`);
  d.close();
  await assert.rejects(Store.open(file), /schema/);
});

test("concurrent ingest from 8 processes × 200 events loses nothing", gate, async () => {
  const file = storeFile(tmp());
  (await Store.open(file)).close();
  const mod = new URL("../src/store/store.js", import.meta.url).href;
  const script = `const { Store } = await import(${JSON.stringify(mod)});
const [file, w] = process.argv.slice(1);
const s = await Store.open(file);
for (let i = 0; i < 200; i++) s.ingest({ producer: "w" + w, seq: i, provider: "claude", account: "work", record: { event: "Stop", sessionId: "s" + w, at: new Date().toISOString() } });
s.close();`;
  await Promise.all(
    Array.from({ length: 8 }, (_, w) =>
      new Promise<void>((resolve, reject) => {
        const c = spawn(process.execPath, ["--input-type=module", "-e", script, file, String(w)], { stdio: "inherit" });
        c.on("error", reject);
        c.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`writer ${w} exited ${code}`))));
      }),
    ),
  );
  const store = await Store.open(file);
  try {
    assert.equal(store.eventCount(), 1600);
    assert.equal(store.sessions().length, 8);
  } finally {
    store.close();
  }
});
