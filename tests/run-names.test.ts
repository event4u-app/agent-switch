import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { cleanText, headingOf, NAME_MAX, parseRunMeta, resolveNames, setRunField } from "../src/run-names.js";
import { readBracket, setRunName } from "../src/bracket.js";

const AT = "2026-11-26T10:00:00Z";

test("names: the user's name, else the agent's, else the task's title, else the run id", () => {
  const empty = parseRunMeta(null);
  assert.deepEqual(resolveNames(empty, { run: "r1", champion: null }), { name: "r1", nameBy: "id" });
  assert.deepEqual(resolveNames(empty, { run: "r1", taskTitle: "Sign the app", champion: null }), { name: "Sign the app", nameBy: "task" });
  const agent = setRunField(empty, "name", "Signing", "agent", AT).meta;
  assert.equal(resolveNames(agent, { run: "r1", taskTitle: "Sign the app", champion: null }).name, "Signing");
  const user = setRunField(agent, "name", "My signing", "user", AT).meta;
  assert.deepEqual(resolveNames(user, { run: "r1", champion: null }), { name: "My signing", nameBy: "user" });
});

test("names: an agent never replaces what the user set, unless forced; empty text clears", () => {
  const user = setRunField(parseRunMeta(null), "name", "Mine", "user", AT).meta;
  const tried = setRunField(user, "name", "Agent's", "agent", AT);
  assert.match(tried.error ?? "", /user set this name/);
  assert.equal(tried.meta.name?.text, "Mine");
  assert.equal(setRunField(user, "name", "Agent's", "agent", AT, { force: true }).meta.name?.text, "Agent's");
  assert.equal(setRunField(user, "name", "  ", "user", AT).meta.name, undefined);
});

test("names: a decision belongs to its champion; another champion falls back to its line's heading, then to 'wins'", () => {
  const meta = setRunField(parseRunMeta(null), "decision", "Sidecar name.json", "agent", AT, { champion: "L004" }).meta;
  assert.deepEqual(resolveNames(meta, { run: "r", champion: "L004" }), { name: "r", nameBy: "id", decision: "Sidecar name.json", decisionBy: "agent" });
  assert.deepEqual(resolveNames(meta, { run: "r", champion: "L001", championHeading: "Rename in place" }).decision, "Rename in place");
  assert.equal(resolveNames(meta, { run: "r", champion: "L001" }).decision, "L001 wins");
  assert.equal(resolveNames(meta, { run: "r", champion: null }).decision, undefined);
});

test("names: one plain line — control, bidi and line-separator characters go, the limit holds, junk reads as empty", () => {
  assert.equal(cleanText("a‮ b\n\tc d"), "a b c d");
  assert.match(setRunField(parseRunMeta(null), "name", "x".repeat(NAME_MAX + 1), "user", AT).error ?? "", /at most 120/);
  assert.deepEqual(parseRunMeta("{not json"), { v: 1 });
  assert.deepEqual(parseRunMeta(JSON.stringify({ name: { text: 42 } })), { v: 1 });
  assert.equal(headingOf("intro\n# Naming arena runs\nbody"), "Naming arena runs");
  assert.equal(headingOf("no heading"), undefined);
});

test("setRunName writes name.json beside bracket.json; readBracket shows it; unknown runs and bad ids are refused", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "as-names-"));
  const dir = path.join(cwd, "agents", "runtime", "bracket", "demo");
  fs.mkdirSync(path.join(dir, "lines"), { recursive: true });
  fs.writeFileSync(path.join(dir, "bracket.json"), JSON.stringify({ round: 1, lines: [{ id: "L001", lineage: "L001", status: "alive" }], matches: [], log: [] }));
  fs.writeFileSync(path.join(dir, "task.md"), "# Task: Name the runs\n");
  assert.equal(readBracket(cwd, "demo")?.name, "Name the runs");
  assert.deepEqual(setRunName(cwd, "demo", "name", "Run names", "agent"), { ok: true });
  assert.equal(readBracket(cwd, "demo")?.name, "Run names");
  assert.equal(readBracket(cwd, "demo")?.nameBy, "agent");
  assert.equal((fs.statSync(path.join(dir, "name.json")).mode & 0o777).toString(8), "600");
  assert.deepEqual(setRunName(cwd, "demo", "name", "Mine", "user"), { ok: true });
  assert.equal(setRunName(cwd, "demo", "name", "Agent again", "agent").ok, false);
  assert.equal(setRunName(cwd, "nope", "name", "x", "user").ok, false);
  assert.equal(setRunName(cwd, "../demo", "name", "x", "user").ok, false);
});
