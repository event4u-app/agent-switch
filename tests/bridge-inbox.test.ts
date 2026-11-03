import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { bridgeApplier, drainInbox, inboxDir, readAck, submitAnswer, waitAck } from "../src/bridge/inbox.js";

const root = () => fs.mkdtempSync(path.join(os.tmpdir(), "as-inbox-"));
const KEY = "claude/work/s1";

test("one decision: the first answer applies, a second for the same approval is rejected", () => {
  const r = root();
  let open = ["a1"];
  const sent: string[] = [];
  const apply = bridgeApplier(() => open, (c) => (sent.push(`${c.cmd}:${c.id}`), (open = open.filter((x) => x !== c.id))));
  const n1 = submitAnswer(r, KEY, { approvalId: "a1", decision: "allow", source: "ssh" });
  const n2 = submitAnswer(r, KEY, { approvalId: "a1", decision: "deny", source: "cli" });
  assert.equal(drainInbox(r, KEY, apply), 2);
  assert.deepEqual(sent, ["approve:a1"]);
  assert.deepEqual(readAck(r, KEY, n1), { status: "applied", reason: "allowed once" });
  assert.equal(readAck(r, KEY, n2)?.status, "rejected");
  assert.equal(drainInbox(r, KEY, apply), 0, "each request is taken once");
});

test("a stale request is refused, never applied late", () => {
  const r = root();
  const sent: string[] = [];
  const n = submitAnswer(r, KEY, { approvalId: "a1", decision: "allow", source: "ssh" }, new Date(Date.now() - 10 * 60_000));
  drainInbox(r, KEY, bridgeApplier(() => ["a1"], (c) => sent.push(c.id)));
  assert.deepEqual(sent, []);
  assert.deepEqual(readAck(r, KEY, n), { status: "rejected", reason: "too old" });
});

test("a planted or malformed request is acknowledged as invalid and not applied", () => {
  const r = root();
  const dir = inboxDir(r, KEY);
  fs.mkdirSync(dir, { recursive: true });
  const nonce = "ab".repeat(16);
  fs.writeFileSync(path.join(dir, `${nonce}.json`), JSON.stringify({ approvalId: "../x", decision: "allow", at: new Date().toISOString() }));
  const target = path.join(r, "secret.json");
  fs.writeFileSync(target, JSON.stringify({ approvalId: "a1", decision: "allow", at: new Date().toISOString() }));
  const link = "cd".repeat(16);
  fs.symlinkSync(target, path.join(dir, `${link}.json`));
  const sent: string[] = [];
  drainInbox(r, KEY, bridgeApplier(() => ["a1"], (c) => sent.push(c.id)));
  assert.deepEqual(sent, [], "neither a bad id nor a symlinked request is applied");
  assert.equal(readAck(r, KEY, nonce)?.reason, "not a valid request");
  assert.equal(readAck(r, KEY, link)?.reason, "not a valid request");
  assert.ok(fs.existsSync(target), "the link target is untouched");
});

test("submitAnswer refuses bad ids and decisions; inboxes are per session", () => {
  const r = root();
  assert.throws(() => submitAnswer(r, KEY, { approvalId: "a b", decision: "allow", source: "cli" }), /approval id/);
  assert.throws(() => submitAnswer(r, KEY, { approvalId: "a1", decision: "always" as never, source: "cli" }), /allow or deny/);
  assert.notEqual(inboxDir(r, KEY), inboxDir(r, "claude/work/s2"));
  submitAnswer(r, KEY, { approvalId: "a1", decision: "deny", source: "cli" });
  assert.equal(fs.statSync(inboxDir(r, KEY)).mode & 0o777, 0o700);
});

test("waitAck returns null when no bridge answers in time", async () => {
  const r = root();
  const n = submitAnswer(r, KEY, { approvalId: "a1", decision: "deny", source: "cli" });
  assert.equal(await waitAck(r, KEY, n, 50, 10), null);
});
