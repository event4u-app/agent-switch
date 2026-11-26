import { test } from "node:test";
import assert from "node:assert/strict";

import { deliberationArgs, parseDeliberation } from "../src/commands/deliberation.js";

test("deliberation: agent-config's JSON is read leniently; an unknown mode is the default off", () => {
  assert.deepEqual(parseDeliberation('{"mode":"auto","source":"session"}\n'), { mode: "auto", source: "session" });
  assert.deepEqual(parseDeliberation('⚠️ notice\n{"mode":"off","source":"global"}'), { mode: "off", source: "global" });
  assert.deepEqual(parseDeliberation('{"mode":"loud"}'), { mode: "off", source: "default" });
  assert.deepEqual(parseDeliberation("not json"), { mode: "off", source: "default" });
});

test("deliberation: get and set pass the session id, never the whole key, and always ask for JSON", () => {
  assert.deepEqual(deliberationArgs("get", undefined, null), ["deliberation:get", "--json"]);
  assert.deepEqual(deliberationArgs("set", "off", null), ["deliberation:set", "off", "--source", "gui", "--json"]);
  assert.deepEqual(deliberationArgs("set", "auto", "e6bc8479-ccc5-4f97-a638-10877aeb96e4"), ["deliberation:set", "auto", "--session", "e6bc8479-ccc5-4f97-a638-10877aeb96e4", "--json"]);
  assert.deepEqual(deliberationArgs("set", "inherit", "s1"), ["deliberation:set", "inherit", "--session", "s1", "--json"]);
});
