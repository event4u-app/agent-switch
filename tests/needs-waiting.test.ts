import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const CLI = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../dist/index.js");

/** One Claude account with one session whose last hook event is `event`, live or not. */
function home(event: "Stop" | "SessionEnd", live: boolean, movedAfter = false, after: string[] = []) {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), "asw-wait-"));
  const cfg = path.join(h, "claude", "work", "config");
  const proj = path.join(cfg, "projects", "-tmp-proj");
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(cfg, ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: "a@example.com", accountUuid: "u" } }));
  const id = "1111aaaa-0000-4000-8000-000000000001";
  const file = path.join(proj, `${id}.jsonl`);
  fs.writeFileSync(file, JSON.stringify({ type: "user", sessionId: id, cwd: "/tmp/proj", message: { role: "user", content: "hi" } }) + "\n" + JSON.stringify({ type: "assistant", sessionId: id, message: { role: "assistant", content: [{ type: "text", text: "done" }], stop_reason: "end_turn" } }) + "\n");
  const t = new Date(Date.now() - 120_000);
  fs.utimesSync(file, t, t);
  if (movedAfter) fs.utimesSync(file, new Date(), new Date());
  fs.mkdirSync(path.join(h, "events"));
  const lines = [event, ...after].map((ev, k) => JSON.stringify({ event: ev, sessionId: id, at: new Date(t.getTime() + 500 + k * 300).toISOString() }));
  fs.writeFileSync(path.join(h, "events", "claude-work.jsonl"), lines.join("\n") + "\n");
  if (live) {
    fs.mkdirSync(path.join(cfg, "sessions"));
    fs.writeFileSync(path.join(cfg, "sessions", `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: id, cwd: "/tmp/proj" }));
  }
  return h;
}

function needs(h: string) {
  return JSON.parse(execFileSync("node", [CLI, "needs", "--json"], { env: { ...process.env, AGENT_SWITCH_HOME: h, HOME: h }, encoding: "utf8" }));
}

test("a live session whose turn ended waits for the next message, until it moves on or ends", { skip: !fs.existsSync(CLI) }, () => {
  const waiting = needs(home("Stop", true));
  assert.deepEqual(waiting.items.map((i: any) => [i.kind, i.what]), [["question", "waits for your next message"]]);
  assert.deepEqual(needs(home("Stop", true, true)).items, [], "the transcript moved after the turn: answered");
  assert.deepEqual(needs(home("Stop", false)).items, [], "not running any more: nothing waits");
  assert.deepEqual(needs(home("SessionEnd", true)).items, [], "the session ended");
  const sub = needs(home("Stop", true, false, ["SubagentStop"]));
  assert.equal(sub.items.length, 1, "a subagent stopping after the turn does not hide the wait");
});
