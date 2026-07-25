import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  assertNotFull,
  exportConfig,
  importConfig,
  FULL_REFUSAL,
  type ConfigBundle,
} from "../src/config-transfer.js";

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "as-config-"));
}

/** Seed a config dir with the allowlisted files + the deny-set items that must
 *  never leave the machine. Returns the temp root (caller cleans it up). */
function seedConfigDir(): { root: string; cfg: string; allow: Record<string, string> } {
  const root = mkTmp();
  const cfg = path.join(root, "config");
  const allow: Record<string, string> = {
    "settings.json": '{"theme":"dark"}',
    "keybindings.json": "{}",
    "CLAUDE.md": "# hi\n",
    "skills/foo.md": "skill body\n",
    "commands/bar.md": "cmd body\n",
    "agents/baz.md": "agent body\n",
  };
  for (const [rel, body] of Object.entries(allow)) {
    const abs = path.join(cfg, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  // Deny-set: account-scoped, must NEVER appear in a bundle.
  fs.writeFileSync(path.join(cfg, ".credentials.json"), '{"claudeAiOauth":{"accessToken":"secret-token"}}');
  fs.writeFileSync(path.join(cfg, ".claude.json"), '{"userID":"private-user"}');
  fs.mkdirSync(path.join(cfg, "sessions"), { recursive: true });
  fs.writeFileSync(path.join(cfg, "sessions", "s1.jsonl"), '{"session":1}');
  return { root, cfg, allow };
}

test("exportConfig excludes the deny-set and includes every allowlisted file", () => {
  const { root, cfg, allow } = seedConfigDir();
  try {
    const bundleStr = exportConfig(cfg);

    // The serialized bundle must carry NO trace of the deny-set.
    assert.ok(!bundleStr.includes("credentials"), "bundle must not contain 'credentials'");
    assert.ok(!bundleStr.includes("claudeAiOauth"), "bundle must not contain the credential body");
    assert.ok(!bundleStr.includes("secret-token"), "bundle must not contain the credential secret");
    assert.ok(!bundleStr.includes(".claude.json"), "bundle must not contain '.claude.json'");
    assert.ok(!bundleStr.includes("sessions/"), "bundle must not contain 'sessions/'");

    const bundle = JSON.parse(bundleStr) as ConfigBundle;
    assert.equal(bundle.version, 1);
    const keys = Object.keys(bundle.files).sort();
    assert.deepEqual(keys, Object.keys(allow).sort(), "bundle keys are exactly the allowlisted files");
    // No deny-set key leaked in as a bundle entry.
    for (const denied of [".credentials.json", ".claude.json", "sessions/s1.jsonl"]) {
      assert.ok(!(denied in bundle.files), `deny-set key ${denied} must be absent`);
    }
    // Contents are base64 of the originals.
    assert.equal(Buffer.from(bundle.files["settings.json"], "base64").toString("utf8"), allow["settings.json"]);
    assert.equal(Buffer.from(bundle.files["skills/foo.md"], "base64").toString("utf8"), allow["skills/foo.md"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("round-trip: export A → import B yields exactly the allowlisted files, no credentials", () => {
  const a = seedConfigDir();
  const bRoot = mkTmp();
  const bCfg = path.join(bRoot, "config");
  try {
    const bundle = exportConfig(a.cfg);
    const written = importConfig(bCfg, bundle).sort();

    assert.deepEqual(written, Object.keys(a.allow).sort(), "wrote exactly the allowlisted files");

    // B has the allowlisted files with identical content.
    for (const [rel, body] of Object.entries(a.allow)) {
      const dst = path.join(bCfg, rel);
      assert.ok(fs.existsSync(dst), `${rel} exists in B`);
      assert.equal(fs.readFileSync(dst, "utf8"), body, `${rel} content matches`);
    }
    // B has NO credential / deny-set files.
    assert.ok(!fs.existsSync(path.join(bCfg, ".credentials.json")), "no .credentials.json in B");
    assert.ok(!fs.existsSync(path.join(bCfg, ".claude.json")), "no .claude.json in B");
    assert.ok(!fs.existsSync(path.join(bCfg, "sessions")), "no sessions/ in B");
  } finally {
    fs.rmSync(a.root, { recursive: true, force: true });
    fs.rmSync(bRoot, { recursive: true, force: true });
  }
});

test("importConfig rejects a '..' traversal entry and writes nothing outside the config dir", () => {
  const root = mkTmp();
  const cfg = path.join(root, "config");
  try {
    const evil: ConfigBundle = { version: 1, files: { "skills/../../escape.md": Buffer.from("pwned").toString("base64") } };
    assert.throws(() => importConfig(cfg, JSON.stringify(evil)), /traversal|escaping/i);
    assert.ok(!fs.existsSync(path.join(root, "escape.md")), "nothing written to the parent");
    assert.ok(!fs.existsSync(path.join(path.dirname(root), "escape.md")), "nothing written above the parent");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("importConfig rejects an absolute path entry", () => {
  const root = mkTmp();
  const cfg = path.join(root, "config");
  const outside = path.join(root, "abs-escape.md");
  try {
    const evil: ConfigBundle = { version: 1, files: { [outside]: Buffer.from("pwned").toString("base64") } };
    assert.throws(() => importConfig(cfg, JSON.stringify(evil)), /absolute/i);
    assert.ok(!fs.existsSync(outside), "nothing written at the absolute path");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("importConfig never writes a deny-set .credentials.json even if present in the bundle", () => {
  const root = mkTmp();
  const cfg = path.join(root, "config");
  try {
    const evil: ConfigBundle = {
      version: 1,
      files: { ".credentials.json": Buffer.from('{"claudeAiOauth":{"accessToken":"x"}}').toString("base64") },
    };
    assert.throws(() => importConfig(cfg, JSON.stringify(evil)), /deny-set|allowlist/i);
    assert.ok(!fs.existsSync(path.join(cfg, ".credentials.json")), "credential file must not be written");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("importConfig bounds untrusted input: too many entries is refused", () => {
  const root = mkTmp();
  const cfg = path.join(root, "config");
  try {
    const files: Record<string, string> = {};
    for (let i = 0; i < 5001; i++) files[`skills/f${i}.md`] = Buffer.from("x").toString("base64");
    assert.throws(() => importConfig(cfg, JSON.stringify({ version: 1, files })), /entries/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("importConfig rejects an unsupported bundle version", () => {
  const root = mkTmp();
  const cfg = path.join(root, "config");
  try {
    assert.throws(() => importConfig(cfg, JSON.stringify({ version: 2, files: {} })), /version/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("--full credential bundling is refused", () => {
  assert.throws(() => assertNotFull(true), new RegExp("account-takeover"));
  assert.ok(FULL_REFUSAL.includes("config-only"));
  // The config-only path (no --full) does not throw.
  assert.doesNotThrow(() => assertNotFull(false));
});
