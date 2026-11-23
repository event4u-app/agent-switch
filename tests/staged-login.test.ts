import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-staged-"));
process.env.AGENT_SWITCH_HOME = home;
const { judgeSignIn, makeStaging, sweepStaleStaging, discardStaging } = await import("../src/staged-login.js");

const acct = (email: string | null, org: string | null = null) => ({ email, org });

test("judgeSignIn: a profile without an account takes any sign-in", () => {
  assert.equal(judgeSignIn(acct(null), acct("x@example.com", "o"), true), "commit");
});

test("judgeSignIn: the email is compared without case", () => {
  assert.equal(judgeSignIn(acct("Work@Example.com", "o"), acct("work@example.com", "o"), true), "commit");
});

test("judgeSignIn: another email or another organization is the wrong account", () => {
  assert.equal(judgeSignIn(acct("a@example.com", "o"), acct("b@example.com", "o"), true), "wrong-account");
  assert.equal(judgeSignIn(acct("a@example.com", "o1"), acct("a@example.com", "o2"), true), "wrong-account");
});

test("judgeSignIn: an organization known on only one side does not decide", () => {
  assert.equal(judgeSignIn(acct("a@example.com", null), acct("a@example.com", "o2"), true), "commit");
  assert.equal(judgeSignIn(acct("a@example.com", "o1"), acct("a@example.com", null), true), "commit");
});

test("judgeSignIn: no credential is unfinished; an unreadable account is never saved over a known one", () => {
  assert.equal(judgeSignIn(acct("a@example.com"), acct("a@example.com"), false), "unfinished");
  assert.equal(judgeSignIn(acct("a@example.com"), acct(null), true), "unreadable");
});

test("sweepStaleStaging: removes staging of dead sign-ins only, and their OS entries", () => {
  const removed: string[] = [];
  const store = { read: () => null, readDefault: () => null, removeEntry: (d: string) => (removed.push(d), true), clearStale: () => undefined };
  const dead = makeStaging("claude", "work", 111);
  const live = makeStaging("codex", "w", 222);
  fs.writeFileSync(path.join(dead, ".credentials.json"), "{}");
  const swept = sweepStaleStaging(store, (pid) => pid === 222);
  assert.deepEqual(swept, ["claude-work-111"]);
  assert.equal(fs.existsSync(dead), false);
  assert.equal(fs.existsSync(live), true);
  assert.deepEqual(removed, [dead]);
  discardStaging("codex", live, store);
  assert.equal(fs.existsSync(path.join(home, "staging")), false, "the empty staging root goes too");
});

test("staging dirs are private", { skip: process.platform === "win32" ? "POSIX modes" : false }, () => {
  const dir = makeStaging("claude", "p", 333);
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  fs.rmSync(home, { recursive: true, force: true });
});
