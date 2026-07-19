import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// profiles.ts reads AGENT_SWITCH_HOME once at module load to compute ROOT, so set
// it BEFORE importing (node's test runner isolates each file in its own process).
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "asw-profiles-"));
process.env.AGENT_SWITCH_HOME = HOME;
const P = await import("../src/profiles.js");

test("ROOT honors AGENT_SWITCH_HOME", () => {
  assert.equal(P.ROOT, HOME);
});

test("paths are provider-scoped: <root>/<provider>/<name>/config", () => {
  assert.equal(P.profileDir("codex", "work"), path.join(HOME, "codex", "work"));
  assert.equal(P.configDir("antigravity", "work"), path.join(HOME, "antigravity", "work", "config"));
  assert.equal(P.browserDir("claude", "work"), path.join(HOME, "claude", "work", "browser"));
});

test("listProfiles is per-provider; listAllProfiles spans providers", () => {
  for (const [prov, name] of [["claude", "a"], ["claude", "b"], ["codex", "c"], ["antigravity", "d"]] as const) {
    fs.mkdirSync(P.configDir(prov, name), { recursive: true });
  }
  assert.deepEqual(P.listProfiles("claude"), ["a", "b"]);
  assert.deepEqual(P.listProfiles("codex"), ["c"]);
  assert.deepEqual(
    P.listAllProfiles().map((r) => `${r.provider}/${r.name}`).sort(),
    ["antigravity/d", "claude/a", "claude/b", "codex/c"],
  );
  assert.equal(P.profileExists("antigravity", "d"), true);
  assert.equal(P.profileExists("antigravity", "x"), false);
});

test("state migrates v1 { active: string } to the per-provider map", () => {
  // v1 shape: a single active name meant the Claude profile.
  fs.writeFileSync(P.STATE_FILE, JSON.stringify({ active: "legacy" }));
  assert.deepEqual(P.readState().active, { claude: "legacy", codex: null, antigravity: null });
});

test("activeFor / setActive are per-provider", () => {
  P.writeState({
    active: { claude: null, codex: null, antigravity: null },
    labels: {},
    autoSwitch: {
      claude: { enabled: false, threshold: 95, tag: "all" },
      codex: { enabled: false, threshold: 95, tag: "all" },
      antigravity: { enabled: false, threshold: 95, tag: "all" },
    },
    providers: {
      claude: { cli: true, ui: true },
      codex: { cli: true, ui: true },
      antigravity: { cli: false, ui: false },
    },
    switchStrategy: "reset-first",
    osNotifications: false,
  }); // clean baseline (shared STATE_FILE)
  P.setActive("codex", "work");
  P.setActive("antigravity", "priv");
  assert.equal(P.activeFor("codex"), "work");
  assert.equal(P.activeFor("antigravity"), "priv");
  assert.equal(P.activeFor("claude"), null);
  P.setActive("codex", null);
  assert.equal(P.activeFor("codex"), null);
});

test("identity reads the provider's account (claude → .claude.json email)", () => {
  fs.mkdirSync(P.configDir("claude", "id"), { recursive: true });
  fs.writeFileSync(
    path.join(P.configDir("claude", "id"), ".claude.json"),
    JSON.stringify({ oauthAccount: { emailAddress: "x@y.com" } }),
  );
  assert.equal(P.identity("claude", "id"), "x@y.com");
  fs.mkdirSync(P.configDir("claude", "noid"), { recursive: true });
  assert.equal(P.identity("claude", "noid"), null);
});

test("labels round-trip per profile and clear cleanly", () => {
  assert.equal(P.labelFor("claude", "lw"), null);
  P.setLabel("claude", "lw", "Work");
  assert.equal(P.labelFor("claude", "lw"), "Work");
  // provider-scoped: same name under a different provider is independent
  assert.equal(P.labelFor("codex", "lw"), null);
  P.clearLabel("claude", "lw");
  assert.equal(P.labelFor("claude", "lw"), null);
});

test("setActive/setLabel do not clobber each other in state.json", () => {
  P.setLabel("claude", "coexist", "Personal");
  P.setActive("claude", "coexist");
  assert.equal(P.labelFor("claude", "coexist"), "Personal");
  assert.equal(P.activeFor("claude"), "coexist");
});

test("auto-switch is per provider — defaults OFF, round-trips, independent, clamps", () => {
  P.setAutoSwitch("claude", { enabled: false });
  P.setAutoSwitch("codex", { enabled: false });
  assert.deepEqual(P.readAutoSwitch("claude"), { enabled: false, threshold: 95, tag: "all" });

  const cfg = P.setAutoSwitch("claude", { enabled: true, threshold: 80 });
  assert.deepEqual(cfg, { enabled: true, threshold: 80, tag: "all" });
  assert.deepEqual(P.readAutoSwitch("claude"), { enabled: true, threshold: 80, tag: "all" });
  // per-provider: enabling claude does not touch codex
  assert.equal(P.readAutoSwitch("codex").enabled, false);

  // readAutoSwitchAll returns every provider's config
  assert.equal(P.readAutoSwitchAll().claude.enabled, true);
  assert.equal(P.readAutoSwitchAll().antigravity.enabled, false);

  // an out-of-range threshold falls back to the default (safety net)
  P.setAutoSwitch("claude", { threshold: 999 });
  assert.equal(P.readAutoSwitch("claude").threshold, 95);

  // tag filter persists; an invalid tag falls back to "all"
  P.setAutoSwitch("claude", { tag: "Work" });
  assert.equal(P.readAutoSwitch("claude").tag, "Work");
  P.setAutoSwitch("claude", { tag: "bogus" as unknown as "all" });
  assert.equal(P.readAutoSwitch("claude").tag, "all");
  P.setAutoSwitch("claude", { enabled: false });
});

test("legacy global auto-switch migrates onto every provider", () => {
  // old shape: a single { enabled, threshold } (pre per-provider)
  P.writeState({
    active: { claude: null, codex: null, antigravity: null },
    labels: {},
    // deliberately the OLD global shape, cast through unknown for the test
    autoSwitch: { enabled: true, threshold: 70 } as unknown as ReturnType<typeof P.readAutoSwitchAll>,
    providers: {
      claude: { cli: true, ui: true },
      codex: { cli: true, ui: true },
      antigravity: { cli: false, ui: false },
    },
    switchStrategy: "reset-first",
    osNotifications: false,
  });
  const all = P.readAutoSwitchAll();
  for (const p of ["claude", "codex", "antigravity"] as const) {
    assert.deepEqual(all[p], { enabled: true, threshold: 70, tag: "all" });
  }
});

test("providers: default enabled = claude + codex; antigravity off; toggles persist", () => {
  // Clean slate with NO antigravity profiles → antigravity is off purely by default.
  fs.rmSync(path.join(HOME, "antigravity"), { recursive: true, force: true });
  fs.rmSync(P.STATE_FILE, { force: true });
  const def = P.readProviders();
  assert.deepEqual(def.claude, { cli: true, ui: true });
  assert.deepEqual(def.codex, { cli: true, ui: true });
  assert.deepEqual(def.antigravity, { cli: false, ui: false });
  assert.deepEqual(P.enabledProviders("cli"), ["claude", "codex"]);

  // Enabling one surface persists and widens enabledProviders.
  P.setProviderSurface("antigravity", "cli", true);
  assert.equal(P.providerEnabled("antigravity", "cli"), true);
  assert.equal(P.providerEnabled("antigravity", "ui"), false);
  assert.deepEqual(P.enabledProviders("cli"), ["claude", "codex", "antigravity"]);

  // Disabling a surface hides it again.
  P.setProviderSurface("codex", "cli", false);
  assert.deepEqual(P.enabledProviders("cli"), ["claude", "antigravity"]);
});

test("providers: a provider with existing profiles is not hidden by default", () => {
  // No `providers` key + antigravity has a profile → default treats antigravity enabled,
  // so an upgrade never hides an account the user already set up.
  fs.rmSync(P.STATE_FILE, { force: true });
  fs.mkdirSync(P.configDir("antigravity", "kept"), { recursive: true });
  assert.equal(P.readProviders().antigravity.cli, true);
});

test("switchStrategy defaults to reset-first and persists a change", () => {
  P.writeState({
    active: { claude: null, codex: null, antigravity: null },
    labels: {},
    autoSwitch: {
      claude: { enabled: false, threshold: 95, tag: "all" },
      codex: { enabled: false, threshold: 95, tag: "all" },
      antigravity: { enabled: false, threshold: 95, tag: "all" },
    },
    providers: {
      claude: { cli: true, ui: true },
      codex: { cli: true, ui: true },
      antigravity: { cli: false, ui: false },
    },
    switchStrategy: "reset-first",
    osNotifications: false,
  });
  assert.equal(P.readSwitchStrategy(), "reset-first");
  P.setSwitchStrategy("rotation-first");
  assert.equal(P.readSwitchStrategy(), "rotation-first");
  // survives a state round-trip that doesn't mention it? setActive rewrites state
  P.setActive("claude", null);
  assert.equal(P.readSwitchStrategy(), "rotation-first");
});

test("osNotifications defaults OFF and persists a change", () => {
  fs.rmSync(P.STATE_FILE, { force: true });
  assert.equal(P.readOsNotifications(), false); // no state file → default off
  P.setOsNotifications(true);
  assert.equal(P.readOsNotifications(), true);
  // survives an unrelated state write
  P.setActive("codex", null);
  assert.equal(P.readOsNotifications(), true);
  P.setOsNotifications(false);
  assert.equal(P.readOsNotifications(), false);
});

test("renameProfile moves the config dir and carries active + label", () => {
  fs.rmSync(P.STATE_FILE, { force: true });
  fs.mkdirSync(P.configDir("codex", "old"), { recursive: true });
  fs.writeFileSync(path.join(P.configDir("codex", "old"), "auth.json"), "{}");
  P.setActive("codex", "old");
  P.setLabel("codex", "old", "Work");

  P.renameProfile("codex", "old", "new");
  assert.equal(fs.existsSync(P.configDir("codex", "new")), true); // moved…
  assert.equal(fs.existsSync(P.configDir("codex", "old")), false); // …source gone
  assert.equal(P.activeFor("codex"), "new"); // active pointer followed
  assert.equal(P.labelFor("codex", "new"), "Work"); // label carried
  assert.equal(P.labelFor("codex", "old"), null);

  // refuses a target that already exists, and a missing source
  fs.mkdirSync(P.configDir("codex", "taken"), { recursive: true });
  assert.throws(() => P.renameProfile("codex", "new", "taken"), /already exists/);
  assert.throws(() => P.renameProfile("codex", "ghost", "x"), /does not exist/);
});

test("renameProfile carries the Claude credential across the config-path (keychain-hash) change", () => {
  fs.rmSync(P.STATE_FILE, { force: true });
  const from = P.configDir("claude", "src");
  fs.mkdirSync(from, { recursive: true });

  // Recording store: read() returns the live (keychain-first) credential from the
  // OLD path; clearStale/removeEntry record the paths they were asked to clear.
  const cleared: string[] = [];
  const removed: string[] = [];
  const store = {
    read: (dir: string) => (dir === from ? "TOKEN" : null),
    readDefault: () => null,
    removeEntry: (dir: string) => (removed.push(dir), true),
    clearStale: (dir: string) => void cleared.push(dir),
  };

  P.renameProfile("claude", "src", "dst", store);

  const dst = P.configDir("claude", "dst");
  assert.equal(fs.existsSync(dst), true); // moved…
  assert.equal(fs.existsSync(from), false); // …source gone
  // credential re-seeded as a plaintext file at the NEW path so a token is readable there
  assert.equal(fs.readFileSync(path.join(dst, ".credentials.json"), "utf8"), "TOKEN");
  assert.deepEqual(cleared, [dst]); // cleared any stale entry at the new path before seeding
  assert.deepEqual(removed, [from]); // dropped the orphaned old-path keychain entry
});
