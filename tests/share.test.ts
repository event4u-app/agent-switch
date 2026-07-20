import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { applySharing, syncSharing, removeSharing, SHARED_ITEMS } from "../src/share.js";

// The share layer links user-level settings from a source into each profile.
// Directories write through the link; files fork on an in-profile write and are
// reconciled by `share sync`. These tests drive that full lifecycle on real
// symlinks. On win32 a file symlink may be refused without Developer Mode — the
// file assertions accept the documented "skipped" degrade there; directory
// (junction) sharing is asserted unconditionally.
const WIN = process.platform === "win32";

function setup(): { root: string; source: string; target: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "asw-share-"));
  const source = path.join(root, "source");
  const target = path.join(root, "profile", "config");
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, "settings.json"), '{"theme":"dark"}');
  fs.mkdirSync(path.join(source, "skills"));
  fs.writeFileSync(path.join(source, "skills", "a.md"), "skill");
  return { root, source, target };
}

test("applySharing links shared directories (write-through) and records the manifest", () => {
  const { root, source, target } = setup();
  try {
    const actions = applySharing(source, target, false);
    // Directory link works on every OS (junction on win32).
    assert.equal(fs.lstatSync(path.join(target, "skills")).isSymbolicLink(), true);
    // A write inside the linked dir reaches the source — the payoff invariant.
    fs.writeFileSync(path.join(target, "skills", "b.md"), "new");
    assert.equal(fs.readFileSync(path.join(source, "skills", "b.md"), "utf8"), "new");
    // Manifest records what we created, so unshare/sync never touch user data.
    const manifest = JSON.parse(fs.readFileSync(path.join(target, ".agent-switch-shared.json"), "utf8"));
    assert.ok(manifest.links.includes("skills"));
    if (!WIN) {
      assert.equal(fs.lstatSync(path.join(target, "settings.json")).isSymbolicLink(), true);
      assert.ok(actions.some((a) => a.includes("linked settings.json")));
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// `plans/` defaults to `<CLAUDE_CONFIG_DIR>/plans/` in Claude Code (verified
// against claude-code 2.1.215: the plan store resolves via the config-home
// function, same as `projects/`), so plan-mode files are isolated per profile
// unless `share on --history` links them. As a directory it writes through the
// link (no atomic-rename fork) — this asserts that payoff on the new item.
test("share on --history links plans/ as a write-through directory", () => {
  const { root, source, target } = setup();
  try {
    fs.mkdirSync(path.join(source, "plans"));
    fs.writeFileSync(path.join(source, "plans", "existing.md"), "plan");
    const actions = applySharing(source, target, true);

    assert.equal(fs.lstatSync(path.join(target, "plans")).isSymbolicLink(), true);
    assert.ok(actions.some((a) => a.includes("linked plans")));
    // A write inside the linked plans/ dir reaches the source (shared, not forked).
    fs.writeFileSync(path.join(target, "plans", "new.md"), "from-profile");
    assert.equal(fs.readFileSync(path.join(source, "plans", "new.md"), "utf8"), "from-profile");

    const manifest = JSON.parse(fs.readFileSync(path.join(target, ".agent-switch-shared.json"), "utf8"));
    assert.ok(manifest.links.includes("plans"));

    // Without --history, plans/ is NOT linked — it stays profile-isolated.
    const { root: r2, source: s2, target: t2 } = setup();
    try {
      fs.mkdirSync(path.join(s2, "plans"));
      applySharing(s2, t2, false);
      assert.equal(fs.existsSync(path.join(t2, "plans")), false);
    } finally {
      fs.rmSync(r2, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("share sync pushes a forked file back to the source and re-links", { skip: WIN ? "file symlinks gated on win32" : false }, () => {
  const { root, source, target } = setup();
  try {
    applySharing(source, target, false);
    // Simulate an in-profile /config write: atomic rename replaces the link
    // with a regular file carrying the profile's edit.
    const forked = path.join(target, "settings.json");
    fs.unlinkSync(forked);
    fs.writeFileSync(forked, '{"theme":"light"}');
    assert.equal(fs.lstatSync(forked).isSymbolicLink(), false); // forked

    const actions = syncSharing(source, target);
    assert.ok(actions.some((a) => a.includes("synced settings.json")));
    // The edit propagated to the source...
    assert.equal(fs.readFileSync(path.join(source, "settings.json"), "utf8"), '{"theme":"light"}');
    // ...and the profile is a link again.
    assert.equal(fs.lstatSync(forked).isSymbolicLink(), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("applySharing reports a forked file instead of clobbering it", { skip: WIN ? "file symlinks gated on win32" : false }, () => {
  const { root, source, target } = setup();
  try {
    applySharing(source, target, false);
    const forked = path.join(target, "settings.json");
    fs.unlinkSync(forked);
    fs.writeFileSync(forked, '{"theme":"light"}');
    const actions = applySharing(source, target, false);
    assert.ok(actions.some((a) => a.startsWith("forked settings.json")));
    // The fork is left intact — not silently re-linked.
    assert.equal(fs.readFileSync(forked, "utf8"), '{"theme":"light"}');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("removeSharing removes only agent-switch-managed links, leaving user copies", () => {
  const { root, source, target } = setup();
  try {
    applySharing(source, target, false);
    const removed = removeSharing(target);
    assert.ok(removed.some((a) => a.includes("unlinked skills")));
    assert.equal(fs.existsSync(path.join(target, "skills")), false);
    // The manifest is emptied so a later share off is a clean no-op.
    const manifest = JSON.parse(fs.readFileSync(path.join(target, ".agent-switch-shared.json"), "utf8"));
    assert.deepEqual(manifest.links, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("applySharing skips a profile's own (non-managed) copy", () => {
  const { root, source, target } = setup();
  try {
    fs.mkdirSync(target, { recursive: true });
    // A pre-existing real directory the user owns — never clobbered.
    fs.mkdirSync(path.join(target, "skills"));
    fs.writeFileSync(path.join(target, "skills", "own.md"), "mine");
    const actions = applySharing(source, target, false);
    assert.ok(actions.some((a) => a.includes("skipped skills")));
    assert.equal(fs.lstatSync(path.join(target, "skills")).isSymbolicLink(), false);
    assert.equal(fs.readFileSync(path.join(target, "skills", "own.md"), "utf8"), "mine");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// Guard: `share on` must never link the account-scoped files that carry MCP
// OAuth state / device tokens (`.claude.json` holds mcpServers + auth,
// `.credentials.json` holds OAuth tokens). Sharing them would pool MCP OAuth
// state across profiles — the latent cross-profile leak flagged in the
// claude-swap comparison. They are account-scoped by design; this locks it.
test("share never links the token-/MCP-OAuth-bearing account files", () => {
  assert.ok(!SHARED_ITEMS.includes(".claude.json"), ".claude.json (mcpServers + auth) must never be shared");
  assert.ok(!SHARED_ITEMS.includes(".credentials.json"), ".credentials.json (OAuth tokens) must never be shared");
  // settings.json IS shared as a whole-file symlink — safe today (Claude Code
  // keeps MCP auth in .claude.json/.credentials.json, both excluded above). If a
  // future version writes mcpServers/tokens into settings.json, this shared
  // surface would need a per-key allowlist (tracked in the 1.0.1 roadmap).
  assert.ok(SHARED_ITEMS.includes("settings.json"), "settings.json is the shared surface this guard watches");
});
