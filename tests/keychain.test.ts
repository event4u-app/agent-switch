import { test } from "node:test";
import assert from "node:assert/strict";
import * as crypto from "node:crypto";

import { serviceNameFor, DEFAULT_SERVICE } from "../src/keychain.js";

// The keychain service-name contract is load-bearing: Claude Code derives its
// macOS keychain service as `"Claude Code-credentials-" + sha256(NFC(raw dir))
// .hex[:8]`, hashing the *unresolved* CLAUDE_CONFIG_DIR string. These tests pin
// that derivation so a refactor cannot silently change the hash (which would
// orphan every profile's credential entry).

test("serviceNameFor uses the documented prefix and an 8-hex suffix", () => {
  const svc = serviceNameFor("/Users/x/.agent-switch/work/config");
  assert.match(svc, new RegExp(`^${DEFAULT_SERVICE}-[0-9a-f]{8}$`));
});

test("serviceNameFor matches the sha256(NFC(dir))[:8] contract exactly", () => {
  const dir = "/Users/x/.agent-switch/work/config";
  const expected = crypto
    .createHash("sha256")
    .update(dir.normalize("NFC"), "utf8")
    .digest("hex")
    .slice(0, 8);
  assert.equal(serviceNameFor(dir), `${DEFAULT_SERVICE}-${expected}`);
});

test("serviceNameFor is deterministic for the same input", () => {
  const dir = "/home/u/.agent-switch/privat/config";
  assert.equal(serviceNameFor(dir), serviceNameFor(dir));
});

test("serviceNameFor NFC-normalizes so composed and decomposed inputs agree", () => {
  // "é" as a single composed code point vs. "e" + combining acute accent.
  const composed = "/tmp/café/config";
  const decomposed = "/tmp/café/config";
  assert.notEqual(composed, decomposed); // genuinely different byte strings
  assert.equal(serviceNameFor(composed), serviceNameFor(decomposed));
});

test("distinct config dirs produce distinct service names", () => {
  assert.notEqual(
    serviceNameFor("/Users/x/.agent-switch/a/config"),
    serviceNameFor("/Users/x/.agent-switch/b/config"),
  );
});
