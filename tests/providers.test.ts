import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { provider, allProviders, isProviderId, PROVIDER_IDS } from "../src/providers.js";

const b64url = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "asw-prov-"));

test("isProviderId guards the three ids", () => {
  assert.equal(isProviderId("codex"), true);
  assert.equal(isProviderId("openai"), false);
  assert.deepEqual([...PROVIDER_IDS], ["claude", "codex", "gemini"]);
});

test("env var + config-dir semantics differ per provider", () => {
  assert.equal(provider("claude").envVar, "CLAUDE_CONFIG_DIR");
  assert.equal(provider("codex").envVar, "CODEX_HOME");
  assert.equal(provider("gemini").envVar, "GEMINI_CLI_HOME");
  // claude/codex: env var names the dir; gemini nests a .gemini subdir.
  assert.equal(provider("claude").configDirFor("/p"), "/p");
  assert.equal(provider("codex").configDirFor("/p"), "/p");
  assert.equal(provider("gemini").configDirFor("/p"), path.join("/p", ".gemini"));
});

test("credential paths + one-shot args + import files per provider", () => {
  assert.equal(provider("claude").credentialPath("/p"), path.join("/p", ".credentials.json"));
  assert.equal(provider("codex").credentialPath("/p"), path.join("/p", "auth.json"));
  assert.equal(provider("gemini").credentialPath("/p"), path.join("/p", "oauth_creds.json"));

  assert.deepEqual(provider("claude").oneShotArgs("hi"), ["-p", "hi"]);
  assert.deepEqual(provider("codex").oneShotArgs("hi"), ["exec", "hi"]);
  assert.deepEqual(provider("gemini").oneShotArgs("hi"), ["-p", "hi", "--output-format", "json"]);

  assert.deepEqual([...provider("claude").importFiles], []);
  assert.deepEqual([...provider("codex").importFiles], ["auth.json"]);
  assert.deepEqual([...provider("gemini").importFiles], ["oauth_creds.json", "google_accounts.json"]);
});

test("readIdentity: claude email, codex JWT email then account_id, gemini active", () => {
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

    // gemini
    fs.writeFileSync(path.join(dir, "google_accounts.json"), JSON.stringify({ active: "gm@x.com", old: [] }));
    assert.equal(provider("gemini").readIdentity(dir), "gm@x.com");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("readIdentity returns null on missing/garbage without throwing", () => {
  const dir = tmp();
  try {
    for (const p of allProviders()) assert.equal(p.readIdentity(dir), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Claude and Codex report a usage readout (auto-switch capable); Gemini does not", () => {
  assert.equal(provider("claude").hasUsageReadout, true);
  assert.equal(provider("codex").hasUsageReadout, true); // live via wham/usage
  assert.equal(provider("gemini").hasUsageReadout, false);
});
