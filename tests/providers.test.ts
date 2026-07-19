import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { provider, allProviders, isProviderId, PROVIDER_IDS, decodeGoKeyringEmail } from "../src/providers.js";

const b64url = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "asw-prov-"));

test("isProviderId guards the three ids", () => {
  assert.equal(isProviderId("codex"), true);
  assert.equal(isProviderId("openai"), false);
  assert.deepEqual([...PROVIDER_IDS], ["claude", "codex", "antigravity"]);
});

test("env var + config-dir semantics differ per provider", () => {
  assert.equal(provider("claude").envVar, "CLAUDE_CONFIG_DIR");
  assert.equal(provider("codex").envVar, "CODEX_HOME");
  // antigravity's only isolation lever is HOME.
  assert.equal(provider("antigravity").envVar, "HOME");
  // All three: the env var value IS the identity dir (antigravity's HOME hosts
  // both its .gemini config and its per-profile keychain under Library/).
  assert.equal(provider("claude").configDirFor("/p"), "/p");
  assert.equal(provider("codex").configDirFor("/p"), "/p");
  assert.equal(provider("antigravity").configDirFor("/p"), "/p");
});

test("credential paths + one-shot args + import files per provider", () => {
  assert.equal(provider("claude").credentialPath("/p"), path.join("/p", ".credentials.json"));
  assert.equal(provider("codex").credentialPath("/p"), path.join("/p", "auth.json"));
  assert.equal(provider("antigravity").credentialPath("/p"), path.join("/p", "Library", "Keychains", "login.keychain-db"));

  assert.deepEqual(provider("claude").oneShotArgs("hi"), ["-p", "hi"]);
  assert.deepEqual(provider("codex").oneShotArgs("hi"), ["exec", "hi"]);
  assert.deepEqual(provider("antigravity").oneShotArgs("hi"), ["--print", "hi"]);

  assert.deepEqual([...provider("claude").importFiles], []);
  assert.deepEqual([...provider("codex").importFiles], ["auth.json"]);
  assert.deepEqual([...provider("antigravity").importFiles], []);
});

test("readIdentity: claude email, codex JWT email then account_id", () => {
  const dir = tmp();
  try {
    // claude
    fs.writeFileSync(path.join(dir, ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: "cl@x.com" } }));
    assert.equal(provider("claude").readIdentity(dir), "cl@x.com");

    // codex — prefer the id_token's email claim
    const idToken = `h.${b64url({ email: "cx@x.com" })}.sig`;
    fs.writeFileSync(path.join(dir, "auth.json"), JSON.stringify({ tokens: { id_token: idToken, account_id: "acc_1" } }));
    assert.equal(provider("codex").readIdentity(dir), "cx@x.com");

    // codex — fall back to account_id when no email claim
    fs.writeFileSync(path.join(dir, "auth.json"), JSON.stringify({ tokens: { account_id: "acc_2" } }));
    assert.equal(provider("codex").readIdentity(dir), "acc_2");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("decodeGoKeyringEmail: extracts the id_token email from agy's go-keyring blob", () => {
  // agy stores its OAuth bundle as `go-keyring-base64:<base64(JSON)>`; the JSON's
  // id_token JWT carries the account email. This is antigravity's identity source.
  const idToken = `h.${b64url({ email: "ag@x.com" })}.sig`;
  const blob = "go-keyring-base64:" + Buffer.from(JSON.stringify({ id_token: idToken })).toString("base64");
  assert.equal(decodeGoKeyringEmail(blob), "ag@x.com");
  // nested shapes tolerated
  const nested = "go-keyring-base64:" + Buffer.from(JSON.stringify({ tokens: { id_token: idToken } })).toString("base64");
  assert.equal(decodeGoKeyringEmail(nested), "ag@x.com");
  // garbage / empty / missing prefix → null, never throws
  assert.equal(decodeGoKeyringEmail(null), null);
  assert.equal(decodeGoKeyringEmail(""), null);
  assert.equal(decodeGoKeyringEmail("not-base64-!!"), null);
  assert.equal(decodeGoKeyringEmail("go-keyring-base64:" + Buffer.from("{}").toString("base64")), null);
});

test("readIdentity returns null on missing/garbage without throwing", () => {
  const dir = tmp();
  try {
    for (const p of allProviders()) assert.equal(p.readIdentity(dir), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Claude and Codex report a usage readout (auto-switch capable); Antigravity does not", () => {
  assert.equal(provider("claude").hasUsageReadout, true);
  assert.equal(provider("codex").hasUsageReadout, true); // live via wham/usage
  assert.equal(provider("antigravity").hasUsageReadout, false);
});
