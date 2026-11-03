import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  addAgent,
  findAgent,
  listAgents,
  localFromCodexArgs,
  localFromOpenCode,
  localMarker,
  MAX_AGENTS,
  parseLocal,
  removeAgent,
  setEnabled,
  setLocal,
  SUGGESTIONS,
  validateAgent,
} from "../src/agents.js";

const file = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "as-agents-")), "agents.json");

test("without a file there are the three built-ins, all on, each in its class", () => {
  const a = listAgents(file());
  assert.deepEqual(a.map((x) => [x.id, x.cls, x.enabled]), [
    ["claude", "deep", true],
    ["codex", "deep", true],
    ["antigravity", "terminal", true],
  ]);
});

test("a suggestion fills in binary and ACP args; added agents are class ACP", () => {
  const f = file();
  const g = addAgent({ id: "gemini" }, f);
  assert.deepEqual([g.binary, g.args, g.cls, g.builtin], ["gemini", ["--acp"], "acp", false]);
  assert.throws(() => addAgent({ id: "gemini" }, f), /already exists/);
  assert.throws(() => addAgent({ id: "codex" }, f), /already exists/);
  removeAgent("gemini", f);
  assert.equal(findAgent("gemini", f), null);
});

test("Google's Antigravity ACP server is not among the suggestions (S6)", () => {
  assert.ok(!SUGGESTIONS.some((s) => s.id.includes("antigravity") || s.binary.includes("agy")));
});

test("rows are argv only: shell strings and control characters are refused", () => {
  const ok = { id: "x", name: "X", binary: "x", args: [] };
  assert.equal(validateAgent(ok), null);
  assert.match(validateAgent({ ...ok, binary: "x; rm -rf ~" })!, /binary/);
  assert.match(validateAgent({ ...ok, binary: "relative/x" })!, /binary/);
  assert.equal(validateAgent({ ...ok, binary: "/opt/my tools/x" }), null);
  assert.match(validateAgent({ ...ok, args: ["a\nb"] })!, /args/);
  assert.match(validateAgent({ ...ok, args: "acp" })!, /args/);
  assert.match(validateAgent({ ...ok, id: "../x" })!, /id/);
});

test("a hand-edited row that fails validation is dropped on read", () => {
  const f = file();
  fs.writeFileSync(f, JSON.stringify({ added: [{ id: "bad", name: "Bad", binary: "a b; c", args: [] }, { id: "ok", name: "Ok", binary: "ok", args: ["acp"] }] }));
  assert.deepEqual(listAgents(f).filter((a) => !a.builtin).map((a) => a.id), ["ok"]);
});

test("built-ins switch off but cannot be removed; the count is capped", () => {
  const f = file();
  setEnabled("antigravity", false, f);
  assert.equal(findAgent("antigravity", f)?.enabled, false);
  setEnabled("antigravity", true, f);
  assert.equal(findAgent("antigravity", f)?.enabled, true);
  assert.throws(() => removeAgent("claude", f), /built in/);
  for (let i = 0; i < MAX_AGENTS - 3; i++) addAgent({ id: `a${i}`, binary: "x", args: [] }, f);
  assert.throws(() => addAgent({ id: "one-more", binary: "x", args: [] }, f), /at most/);
});

test("parseLocal splits on the first colon and checks the runner", () => {
  assert.deepEqual(parseLocal("ollama:qwen3-coder:30b"), { runner: "ollama", model: "qwen3-coder:30b" });
  assert.throws(() => parseLocal("docker:x"), /use/);
  assert.throws(() => parseLocal("ollama:"), /use/);
});

test("the local marker: named by the user, or read from the agent's own config", () => {
  const f = file();
  addAgent({ id: "opencode" }, f);
  const oc = { model: "ollama/qwen3-coder:30b", provider: { ollama: { npm: "@ai-sdk/openai-compatible", options: { baseURL: "http://localhost:11434/v1" } } } };
  assert.deepEqual(localMarker(findAgent("opencode", f)!, () => oc), { runner: "ollama", model: "qwen3-coder:30b" });
  const remote = { ...oc, provider: { ollama: { options: { baseURL: "https://api.example.com/v1" } } } };
  assert.equal(localMarker(findAgent("opencode", f)!, () => remote), null, "a remote base URL is not local");
  assert.equal(localMarker(findAgent("claude", f)!, () => oc), null);
  setLocal("opencode", { runner: "lmstudio", model: "qwen2.5" }, f);
  assert.deepEqual(localMarker(findAgent("opencode", f)!, () => oc), { runner: "lmstudio", model: "qwen2.5" });
  assert.throws(() => setLocal("antigravity", { runner: "ollama", model: "x" }, f), /no local model/);
});

test("OpenCode and Codex local detection, pure", () => {
  assert.deepEqual(localFromOpenCode({ model: "lms/q", provider: { lms: { options: { baseURL: "http://127.0.0.1:1234/v1" } } } }), { runner: "lmstudio", model: "q" });
  assert.equal(localFromOpenCode({ model: "anthropic/claude" }), null);
  assert.equal(localFromOpenCode(null), null);
  assert.deepEqual(localFromCodexArgs(["--oss", "--local-provider", "ollama", "-m", "gpt-oss:20b"]), { runner: "ollama", model: "gpt-oss:20b" });
  assert.equal(localFromCodexArgs(["-m", "gpt-5"]), null);
});
