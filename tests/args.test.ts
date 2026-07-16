import { test } from "node:test";
import assert from "node:assert/strict";

import { parseArgs, parseRun, resolveProviderValue } from "../src/args.js";

// Round-2 review F1: a value-flag's VALUE must never leak into the positionals.
// `remove --provider codex opfer` must target `opfer`, not `codex`.

test("parseArgs consumes --provider's value (flag-first) — value does NOT leak into positionals", () => {
  const p = parseArgs(["remove", "--provider", "codex", "opfer"]);
  assert.equal(p.cmd, "remove");
  assert.equal(p.providerId, "codex");
  assert.equal(p.providerExplicit, true);
  assert.deepEqual(p.positional, ["opfer"]); // NOT ["codex", "opfer"]
});

test("parseArgs handles the flag AFTER the positional too", () => {
  const p = parseArgs(["remove", "opfer", "--provider", "codex"]);
  assert.equal(p.providerId, "codex");
  assert.deepEqual(p.positional, ["opfer"]);
});

test("parseArgs collects boolean flags and defaults provider to claude", () => {
  const p = parseArgs(["list", "--json"]);
  assert.equal(p.cmd, "list");
  assert.equal(p.providerId, "claude");
  assert.equal(p.providerExplicit, false);
  assert.equal(p.flags.json, true);
  assert.deepEqual(p.positional, []);

  const r = parseArgs(["remove", "opfer", "--force"]);
  assert.equal(r.flags.force, true);
  assert.deepEqual(r.positional, ["opfer"]);
});

test("parseArgs consumes --shell / --source values", () => {
  assert.equal(parseArgs(["shellenv", "--shell", "fish"]).flags.shell, "fish");
  assert.deepEqual(parseArgs(["shellenv", "--shell", "fish"]).positional, []);
  const s = parseArgs(["share", "on", "--source", "work"]);
  assert.deepEqual(s.positional, ["on"]); // "work" is the --source value, not a positional
  assert.equal(s.flags.source, "work");
});

test("parseArgs consumes notify's --kind/--title/--message values (regression: GUI notify + fetch-fail alerts)", () => {
  // These flags carry the notification content. If any is treated as a boolean
  // switch, its value leaks into positionals and `notify` dies with
  // "needs at least --title or --message" — the bug behind the dead test button
  // and the missing usage-fetch-failure notifications.
  const p = parseArgs(["notify", "--kind", "success", "--title", "Auto-switched account", "--message", "a → b (dev test)."]);
  assert.equal(p.flags.kind, "success");
  assert.equal(p.flags.title, "Auto-switched account");
  assert.equal(p.flags.message, "a → b (dev test).");
  assert.deepEqual(p.positional, []); // none of the values leaked in
});

test("parseArgs consumes providers' --surface value", () => {
  const p = parseArgs(["providers", "enable", "--provider", "claude", "--surface", "cli"]);
  assert.equal(p.flags.surface, "cli");
  assert.equal(p.providerId, "claude");
  assert.deepEqual(p.positional, ["enable"]); // "cli" is the --surface value, not a positional
});

test("parseArgs throws on an explicit invalid provider (testable, not process.exit)", () => {
  assert.throws(() => parseArgs(["use", "--provider", "bogus", "x"]), /unknown provider/);
});

test("resolveProviderValue: undefined → claude, valid → itself, invalid → throws", () => {
  assert.equal(resolveProviderValue(undefined), "claude");
  assert.equal(resolveProviderValue("gemini"), "gemini");
  assert.throws(() => resolveProviderValue("nope"), /unknown provider/);
});

test("parseRun strips --provider but passes the rest through verbatim", () => {
  assert.deepEqual(parseRun(["--provider", "codex", "work", "exec", "hi"]), {
    providerId: "codex",
    name: "work",
    args: ["exec", "hi"],
  });
  // passthrough flags (for the underlying binary) survive
  assert.deepEqual(parseRun(["work", "--", "--resume"]), {
    providerId: "claude",
    name: "work",
    args: ["--", "--resume"],
  });
});
