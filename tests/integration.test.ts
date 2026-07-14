import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { serviceNameFor } from "../src/keychain.js";

// Integration tests that touch a real Claude Code install / live network / the
// real filesystem's symlink semantics. They are OFF by default because CI and
// the sandbox have no logged-in profile — set AGENT_SWITCH_CONTRACT_TESTS=1 on a
// machine with a real login to exercise them.
const CONTRACT = process.env.AGENT_SWITCH_CONTRACT_TESTS === "1";
const gated = { skip: CONTRACT ? false : "set AGENT_SWITCH_CONTRACT_TESTS=1 to run" };

// Step 2 — macOS keychain service-hash contract against a real install.
// With a profile whose config dir is `dir`, Claude Code must have stored its
// credential under service `serviceNameFor(dir)`. Proves the derivation matches
// Claude Code's own hashing on the current version.
test("keychain: derived service name resolves a real credential (macOS)", gated, () => {
  if (process.platform !== "darwin") return; // macOS-only contract
  const dir = process.env.AGENT_SWITCH_CONTRACT_CONFIG_DIR;
  assert.ok(dir, "set AGENT_SWITCH_CONTRACT_CONFIG_DIR to a logged-in profile's config dir");
  const svc = serviceNameFor(dir);
  // Throws (non-zero exit) if the entry is absent → the derivation is wrong.
  const out = execFileSync(
    "security",
    ["find-generic-password", "-a", os.userInfo().username, "-s", svc],
    { encoding: "utf8" },
  );
  assert.match(out, /class:/); // a real keychain record was returned
});

// Step 3 — usage API response shape against a live response.
// Confirms the fields formatUsage() expects are actually present.
test("usage: live OAuth /usage response carries the expected windows", gated, async () => {
  const token = process.env.AGENT_SWITCH_CONTRACT_ACCESS_TOKEN;
  assert.ok(token, "set AGENT_SWITCH_CONTRACT_ACCESS_TOKEN to a live OAuth access token");
  const res = await fetch("https://api.anthropic.com/api/oauth/usage", {
    headers: {
      Authorization: `Bearer ${token}`,
      "anthropic-beta": "oauth-2025-04-20",
      // A User-Agent is required — the endpoint rate-limits (429) without one.
      "User-Agent": "agent-switch-contract-test",
    },
  });
  assert.equal(res.ok, true, `usage endpoint returned ${res.status}`);
  const body: any = await res.json();
  const window = body?.five_hour ?? body?.seven_day;
  assert.ok(window && typeof window === "object", "no five_hour/seven_day window in response");
});

// Step 4 — settings-writer symlink behavior on the current Claude Code version.
// Documents/verifies the #40857 finding: writing a symlinked FILE replaces the
// link with a regular file (atomic rename), while writes INSIDE a symlinked
// DIRECTORY land in the link target. This test checks the filesystem primitive
// the finding rests on (atomic rename breaks a file symlink); the Claude-Code
// side is asserted separately by the owner on a real install.
test("share: atomic rename over a symlinked file replaces the link (fs primitive)", gated, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agent-switch-share-"));
  try {
    const target = path.join(tmp, "source.json");
    const link = path.join(tmp, "linked.json");
    fs.writeFileSync(target, "{}");
    fs.symlinkSync(target, link);
    assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
    // Simulate an atomic-rename writer (write temp, rename over the link).
    const tmpWrite = path.join(tmp, ".linked.json.tmp");
    fs.writeFileSync(tmpWrite, '{"x":1}');
    fs.renameSync(tmpWrite, link);
    // The link is now a regular file — write did NOT pass through to target.
    assert.equal(fs.lstatSync(link).isSymbolicLink(), false);
    assert.equal(fs.readFileSync(target, "utf8"), "{}"); // target untouched
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// road-to-session-handoff Phase 2 — the g01 flow through the real CLI: create a
// canary session under profile A, `takeover` it to profile B, resume there and
// get the canary back. Proves the move+resume semantics end-to-end on the
// CURRENT Claude Code version (they are upstream-documented but version-
// sensitive — this is the canary that fails loud on drift, roadmap risk #1).
// Cost: 2 short non-interactive claude turns. Uses the REAL ~/.agent-switch.
test("takeover: canary session moves between two logged-in profiles and resumes", gated, () => {
  const src = process.env.AGENT_SWITCH_CONTRACT_SRC_PROFILE;
  const tgt = process.env.AGENT_SWITCH_CONTRACT_TGT_PROFILE;
  assert.ok(
    src && tgt,
    "set AGENT_SWITCH_CONTRACT_SRC_PROFILE and AGENT_SWITCH_CONTRACT_TGT_PROFILE to two logged-in claude profiles",
  );
  const CLI = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../dist/index.js");
  assert.ok(fs.existsSync(CLI), "run `npm run build` first");
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "asw-contract-takeover-"));
  const canary = `asw-contract-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const cli = (args: string[]) =>
    execFileSync("node", [CLI, ...args], { cwd: workdir, encoding: "utf8" });
  try {
    const created = JSON.parse(
      cli(["run", src!, "--", "-p", "--output-format", "json",
        `Remember this codeword and nothing else: ${canary}. Reply only: stored.`]),
    );
    const id = created?.session_id;
    assert.ok(typeof id === "string" && id.length > 0, "no session_id from create turn");

    const out = cli(["takeover", id, "--to", tgt!, "--from", src!, "--print-only"]);
    assert.match(out, /verified/); // the copy→verify→delete transfer ran

    const resumed = JSON.parse(
      cli(["run", tgt!, "--", "-p", "--resume", id, "--output-format", "json",
        "What is the codeword I asked you to remember? Reply with only the codeword."]),
    );
    assert.ok(String(resumed?.result ?? "").includes(canary), "canary missing after handoff");
  } finally {
    fs.rmSync(workdir, { recursive: true, force: true });
  }
});

// Step 4 (companion) — writes INSIDE a symlinked directory land in the target.
// This is the other half of the #40857 finding and the load-bearing invariant
// for Phase 2's `share` rework: directories (skills/, agents/, commands/) are
// shared by linking the directory, so a file created in the profile's linked
// dir must appear in the share source. Pure fs primitive — cross-platform, no
// real install needed, so it runs everywhere (not gated).
test("share: a write inside a symlinked directory lands in the target (fs primitive)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agent-switch-dir-"));
  try {
    const source = path.join(tmp, "source");
    const link = path.join(tmp, "linked");
    fs.mkdirSync(source);
    try {
      // "junction" is honored on win32 and ignored elsewhere — matches how
      // Phase 2's share links directories per OS.
      fs.symlinkSync(source, link, process.platform === "win32" ? "junction" : "dir");
    } catch (err: any) {
      // win32 without Developer Mode/admin can refuse even dir symlinks; a
      // junction should still work, but if the whole primitive is unavailable
      // skip rather than fail (the CI windows runner asserts it for real).
      if (process.platform === "win32") return;
      throw err;
    }
    fs.writeFileSync(path.join(link, "skill.md"), "shared");
    // The file is visible through the source dir — the link wrote through.
    assert.equal(fs.readFileSync(path.join(source, "skill.md"), "utf8"), "shared");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
