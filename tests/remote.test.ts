import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { readRemote, remoteControlArgs, remoteControlName, rpc, RPC_METHODS, setRemoteControl, setSsh, type RpcDeps } from "../src/remote.js";

const file = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "as-remote-")), "remote.json");

test("everything is off until turned on", () => {
  assert.deepEqual(readRemote(file()), { remoteControlAccounts: [], ssh: false });
});

test("R1: --remote-control only for Claude, per session or per account, never a permission mode", () => {
  const f = file();
  const off = readRemote(f);
  assert.deepEqual(remoteControlArgs("claude", "work", false, "x", off), []);
  assert.deepEqual(remoteControlArgs("claude", "work", true, "Fix: login/flow", off), ["--remote-control", "Fix login flow"]);
  const on = setRemoteControl("work", true, f);
  assert.deepEqual(remoteControlArgs("claude", "work", false, "s", on), ["--remote-control", "s"]);
  assert.deepEqual(remoteControlArgs("claude", "personal", false, "s", on), []);
  assert.deepEqual(remoteControlArgs("codex", "work", true, "s", on), []);
  assert.ok(!remoteControlArgs("claude", "work", true, "--permission-mode bypassPermissions", on).some((a) => a === "--permission-mode"));
  assert.deepEqual(setRemoteControl("work", false, f).remoteControlAccounts, []);
  assert.throws(() => setRemoteControl("../x", true, f), /account/);
});

test("remoteControlName keeps a safe, bounded name", () => {
  assert.equal(remoteControlName("$(rm -rf ~)"), "rm -rf");
  assert.equal(remoteControlName("ü"), "agent-switch");
  assert.equal(remoteControlName("a".repeat(100)).length, 60);
});

function deps(): RpcDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    needs: () => ({ items: [] }),
    answer: async (key, id, d) => (calls.push(`${key}:${id}:${d}`), { status: "applied", reason: "ok" }),
  };
}

test("rpc: off by default, and nothing answers while off", async () => {
  const d = deps();
  const r = await rpc(JSON.stringify({ id: 1, method: "needs.list" }), d, { remoteControlAccounts: [], ssh: false });
  assert.deepEqual(r, { id: 1, ok: false, error: { code: "off", message: "remote over SSH is off (agent-switch remote ssh on)" } });
});

test("rpc: the method table is the whole surface; nothing escalates", async () => {
  const d = deps();
  const on = { remoteControlAccounts: [], ssh: true };
  assert.deepEqual(Object.keys(RPC_METHODS).sort(), ["approval.allow_once", "approval.deny", "needs.list"]);
  for (const m of ["settings.set", "session.set_mode", "approval.allow_always", "agents.add", "pairing.create", "__proto__", "toString", "constructor"]) {
    const r = await rpc(JSON.stringify({ id: m, method: m, params: { mode: "bypassPermissions" } }), d, on);
    assert.equal(r.ok, false, m);
    assert.equal(!r.ok && r.error.code, "not_implemented", m);
  }
  assert.deepEqual(d.calls, []);
});

test("rpc: approvals need valid ids and go through the bridge's own decision", async () => {
  const d = deps();
  const on = { remoteControlAccounts: [], ssh: true };
  const bad = await rpc(JSON.stringify({ id: 2, method: "approval.allow_once", params: { session: "claude/work/../../x", approval: "a1" } }), d, on);
  assert.equal(!bad.ok && bad.error.code, "bad_request");
  const ok = await rpc(JSON.stringify({ id: 3, method: "approval.deny", params: { session: "acp/gemini/s-1", approval: "t9" } }), d, on);
  assert.equal(ok.ok, true);
  assert.deepEqual(d.calls, ["acp/gemini/s-1:t9:deny"]);
  const none = await rpc(JSON.stringify({ id: 4, method: "approval.allow_once", params: { session: "claude/work/s1", approval: "a1" } }), { ...d, answer: async () => ({ status: "no-bridge", reason: "" }) }, on);
  assert.deepEqual(none, { id: 4, ok: false, error: { code: "rejected", message: "no chat holds this session right now" } });
  assert.equal((await rpc("{not json", d, on)).ok, false);
});

test("setSsh round-trips", () => {
  const f = file();
  assert.equal(setSsh(true, f).ssh, true);
  assert.equal(readRemote(f).ssh, true);
});
