/** Profile roots, per-provider state, layout migration, and shared helpers. */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ProviderId, PROVIDER_IDS, provider, isProviderId } from "./providers.js";
import { CredentialStore, credentialStore } from "./credentials.js";

export const HOME = os.homedir();
export const ROOT = process.env.AGENT_SWITCH_HOME ?? path.join(HOME, ".agent-switch");
export const STATE_FILE = path.join(ROOT, "state.json");

/** The active profile name per provider. */
export type ActiveMap = Record<ProviderId, string | null>;

/** Optional profile type/tag, to tell work vs personal accounts apart. */
export const PROFILE_LABELS = ["Work", "Personal", "Other"] as const;
export type ProfileLabel = (typeof PROFILE_LABELS)[number];
export function isProfileLabel(v: unknown): v is ProfileLabel {
  return typeof v === "string" && (PROFILE_LABELS as readonly string[]).includes(v);
}

/** `"claude/work"` → label. Flat keys keep the shape trivially serialisable. */
export type LabelMap = Record<string, ProfileLabel>;

/**
 * Opt-in auto-switch (default OFF). When enabled, the daemon switches the active
 * profile to the same-provider account with the most headroom once the active
 * one crosses `threshold`% on any window. This pools accounts to route around
 * rate limits — off by default because it may conflict with a provider's usage
 * policy; the operator turns it on deliberately.
 */
export interface AutoSwitchConfig {
  enabled: boolean;
  threshold: number; // percent (1-100)
}
export const DEFAULT_AUTOSWITCH: AutoSwitchConfig = { enabled: false, threshold: 95 };

/** Auto-switch is configured PER PROVIDER (claude/codex/gemini each on/off). */
export type AutoSwitchMap = Record<ProviderId, AutoSwitchConfig>;

/**
 * Which surfaces of a provider are enabled (offered in the GUI / allowed by the
 * CLI). `cli` = the terminal tool; `ui` = the provider's desktop/GUI app, if any.
 * Disabling a provider hides it without deleting its profiles — re-enabling
 * restores everything.
 */
export interface ProviderSurfaces {
  cli: boolean;
  ui: boolean;
}
export type ProviderSurface = keyof ProviderSurfaces;
export type ProvidersConfig = Record<ProviderId, ProviderSurfaces>;

/**
 * Providers enabled out of the box. Everything else is available but off by
 * default — the user opts it in from the Providers settings tab. A provider that
 * already has profiles is also treated as enabled on first migration, so
 * upgrading never hides an account the user already set up.
 */
export const PROVIDERS_ON_BY_DEFAULT: readonly ProviderId[] = ["claude", "codex"];

export interface State {
  active: ActiveMap;
  labels: LabelMap;
  autoSwitch: AutoSwitchMap;
  providers: ProvidersConfig;
}

function emptyActive(): ActiveMap {
  return { claude: null, codex: null, gemini: null };
}

function labelKey(providerId: ProviderId, name: string): string {
  return `${providerId}/${name}`;
}

export function die(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

export function ensureRoot(): void {
  fs.mkdirSync(ROOT, { recursive: true, mode: 0o700 });
}

function validateName(name: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) die(`invalid profile name "${name}" (use a-z, 0-9, -, _)`);
}

export function profileDir(providerId: ProviderId, name: string): string {
  validateName(name);
  return path.join(ROOT, providerId, name);
}

/**
 * The value exported as the provider's isolation env var
 * (`<root>/<provider>/<name>/config`).
 *
 * IMPORTANT (macOS/claude): Claude Code derives its Keychain service name by
 * hashing the *exact, unresolved* CLAUDE_CONFIG_DIR string. This function is
 * the single source of that string — never pass a resolved/realpath variant.
 * Changing this path for an existing profile changes the hash (see
 * `migrateLegacyLayout`, which re-seeds the credential across the move).
 */
export function configDir(providerId: ProviderId, name: string): string {
  return path.join(profileDir(providerId, name), "config");
}

export function browserDir(providerId: ProviderId, name: string): string {
  return path.join(profileDir(providerId, name), "browser");
}

export function profileExists(providerId: ProviderId, name: string): boolean {
  return fs.existsSync(configDir(providerId, name));
}

/** Profile names for one provider (dirs with a `config/` subdir), sorted. */
export function listProfiles(providerId: ProviderId): string[] {
  const dir = path.join(ROOT, providerId);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, "config")))
    .map((e) => e.name)
    .sort();
}

/** Every profile across all providers. */
export function listAllProfiles(): { provider: ProviderId; name: string }[] {
  return PROVIDER_IDS.flatMap((p) => listProfiles(p).map((name) => ({ provider: p, name })));
}

export function requireProfile(providerId: ProviderId, name: string | undefined, cmd: string): string {
  if (!name) die(`usage: agent-switch ${cmd} <profile>`);
  if (!profileExists(providerId, name)) {
    const existing = listProfiles(providerId).join(", ") || "(none)";
    die(`profile "${name}" not found for ${providerId}. Existing: ${existing}`);
  }
  return name;
}

/** Best-effort account identity for a profile, via its provider. */
export function identity(providerId: ProviderId, name: string): string | null {
  const p = provider(providerId);
  return p.readIdentity(p.configDirFor(configDir(providerId, name)));
}

// ---------- state (per-provider active), with v1 → v2 migration ----------

function normalizeLabels(raw: unknown): LabelMap {
  const out: LabelMap = {};
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (isProfileLabel(v)) out[k] = v;
    }
  }
  return out;
}

function normalizeAutoSwitch(raw: unknown): AutoSwitchConfig {
  const r = (raw ?? {}) as Partial<AutoSwitchConfig>;
  const threshold = typeof r.threshold === "number" && r.threshold >= 1 && r.threshold <= 100 ? Math.round(r.threshold) : DEFAULT_AUTOSWITCH.threshold;
  return { enabled: r.enabled === true, threshold };
}

function emptyAutoSwitch(): AutoSwitchMap {
  return { claude: { ...DEFAULT_AUTOSWITCH }, codex: { ...DEFAULT_AUTOSWITCH }, gemini: { ...DEFAULT_AUTOSWITCH } };
}

function normalizeAutoSwitchMap(raw: unknown): AutoSwitchMap {
  const r = (raw ?? {}) as Record<string, unknown>;
  // Migration: a single global `{ enabled, threshold }` (the old shape) applies
  // to every provider, so turning per-provider on doesn't silently disable it.
  if ("enabled" in r || "threshold" in r) {
    const one = normalizeAutoSwitch(r);
    return { claude: { ...one }, codex: { ...one }, gemini: { ...one } };
  }
  const out = emptyAutoSwitch();
  for (const p of PROVIDER_IDS) out[p] = normalizeAutoSwitch(r[p]);
  return out;
}

/** Default enabled-state for a provider when its config key is absent: on when
 *  in the default set OR when it already has profiles (never hide existing). */
function defaultSurfaces(id: ProviderId): ProviderSurfaces {
  const on = PROVIDERS_ON_BY_DEFAULT.includes(id) || listProfiles(id).length > 0;
  return { cli: on, ui: on };
}

function normalizeSurfaces(raw: unknown, id: ProviderId): ProviderSurfaces {
  const r = (raw ?? {}) as Partial<ProviderSurfaces>;
  const d = defaultSurfaces(id);
  return {
    cli: typeof r.cli === "boolean" ? r.cli : d.cli,
    ui: typeof r.ui === "boolean" ? r.ui : d.ui,
  };
}

function emptyProviders(): ProvidersConfig {
  return Object.fromEntries(PROVIDER_IDS.map((p) => [p, defaultSurfaces(p)])) as ProvidersConfig;
}

function normalizeProvidersMap(raw: unknown): ProvidersConfig {
  const r = (raw ?? {}) as Record<string, unknown>;
  const out = emptyProviders();
  for (const p of PROVIDER_IDS) out[p] = normalizeSurfaces(r[p], p);
  return out;
}

export function readState(): State {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    const labels = normalizeLabels(raw?.labels);
    const autoSwitch = normalizeAutoSwitchMap(raw?.autoSwitch);
    const providers = normalizeProvidersMap(raw?.providers);
    // v1: { active: "<name>" } — a single Claude profile.
    if (typeof raw?.active === "string") {
      return { active: { ...emptyActive(), claude: raw.active }, labels, autoSwitch, providers };
    }
    if (raw?.active && typeof raw.active === "object") {
      return { active: { ...emptyActive(), ...raw.active }, labels, autoSwitch, providers };
    }
    return { active: emptyActive(), labels, autoSwitch, providers };
  } catch {
    /* absent / unparsable → default */
  }
  return { active: emptyActive(), labels: {}, autoSwitch: emptyAutoSwitch(), providers: emptyProviders() };
}

export function writeState(state: State): void {
  ensureRoot();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
}

export function activeFor(providerId: ProviderId): string | null {
  return readState().active[providerId];
}

export function setActive(providerId: ProviderId, name: string | null): void {
  const state = readState();
  state.active[providerId] = name;
  writeState(state);
}

export function labelFor(providerId: ProviderId, name: string): ProfileLabel | null {
  return readState().labels[labelKey(providerId, name)] ?? null;
}

/** Set (or clear, with null) a profile's label. */
export function setLabel(providerId: ProviderId, name: string, label: ProfileLabel | null): void {
  const state = readState();
  const key = labelKey(providerId, name);
  if (label) state.labels[key] = label;
  else delete state.labels[key];
  writeState(state);
}

/** Drop a removed profile's label so it can't linger as an orphan. */
export function clearLabel(providerId: ProviderId, name: string): void {
  setLabel(providerId, name, null);
}

export function readAutoSwitch(providerId: ProviderId): AutoSwitchConfig {
  return readState().autoSwitch[providerId];
}

/** All providers' auto-switch configs (for `status` / the GUI tab dots). */
export function readAutoSwitchAll(): AutoSwitchMap {
  return readState().autoSwitch;
}

export function setAutoSwitch(providerId: ProviderId, cfg: Partial<AutoSwitchConfig>): AutoSwitchConfig {
  const state = readState();
  state.autoSwitch[providerId] = normalizeAutoSwitch({ ...state.autoSwitch[providerId], ...cfg });
  writeState(state);
  return state.autoSwitch[providerId];
}

// ---------- provider enable/disable (per surface) ----------

/** Every provider's enabled surfaces (for `providers status` / the GUI tab). */
export function readProviders(): ProvidersConfig {
  return readState().providers;
}

/** Is a provider enabled? With a surface, that specific surface; without, either. */
export function providerEnabled(providerId: ProviderId, surface?: ProviderSurface): boolean {
  const s = readState().providers[providerId];
  return surface ? s[surface] : s.cli || s.ui;
}

/** Provider ids whose given surface is enabled (default `cli`), in canonical order. */
export function enabledProviders(surface: ProviderSurface = "cli"): ProviderId[] {
  const cfg = readState().providers;
  return PROVIDER_IDS.filter((p) => cfg[p][surface]);
}

/** Enable/disable one surface of a provider; returns its new surface state. */
export function setProviderSurface(providerId: ProviderId, surface: ProviderSurface, enabled: boolean): ProviderSurfaces {
  const state = readState();
  state.providers[providerId] = { ...state.providers[providerId], [surface]: enabled };
  writeState(state);
  return state.providers[providerId];
}

// ---------- layout migration: v1 <ROOT>/<name> → <ROOT>/claude/<name> ----------

/**
 * One-time migration of v1 Claude profiles (`<ROOT>/<name>/config`) into the
 * provider-scoped layout (`<ROOT>/claude/<name>/config`). Copy-then-verify;
 * aborts a single profile on verify failure and keeps the original.
 *
 * The config-dir path change alters the macOS Keychain service hash, so the
 * credential is read from the old location and re-seeded as a plaintext
 * `.credentials.json` (the supported path — Claude Code re-migrates it into the
 * new hashed entry on first use). On linux/win the credential file simply moves
 * with the dir. Idempotent: once every legacy dir is under `<provider>/`, a
 * re-run does nothing. Returns the names migrated.
 */
/**
 * One-time marker so migration is not re-scanned on every command launch.
 * Limitation (accepted, low-risk): a v1-layout profile that appears AFTER the
 * marker is written (e.g. a backup restored into ROOT) is not auto-migrated —
 * re-scanning on every launch to catch that is exactly the startup tax the
 * marker exists to avoid. Delete `.layout-v2` to force a re-scan.
 */
const LAYOUT_MARKER = path.join(ROOT, ".layout-v2");

export function migrateLegacyLayout(store: CredentialStore = credentialStore()): string[] {
  if (!fs.existsSync(ROOT)) return [];
  if (fs.existsSync(LAYOUT_MARKER)) return []; // already migrated — cheap early-out
  const moved: string[] = [];
  for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory() || isProviderId(entry.name)) continue; // already provider-scoped
    const oldProfile = path.join(ROOT, entry.name);
    const oldConfig = path.join(oldProfile, "config");
    if (!fs.existsSync(oldConfig)) continue; // not a v1 profile dir
    const newProfile = path.join(ROOT, "claude", entry.name);
    if (fs.existsSync(newProfile)) continue; // name clash → leave for the user to resolve

    // Capture the credential BEFORE the path (and thus the hash) changes.
    const cred = store.read(oldConfig);

    fs.mkdirSync(path.join(ROOT, "claude"), { recursive: true, mode: 0o700 });
    fs.cpSync(oldProfile, newProfile, { recursive: true });
    const newConfig = path.join(newProfile, "config");
    if (!fs.existsSync(newConfig)) {
      fs.rmSync(newProfile, { recursive: true, force: true }); // verify failed → abort this one
      continue;
    }

    // Re-seed the credential so the new-path hash resolves it (macOS); on
    // linux/win the file was copied already. Always OVERWRITE: `cred` was read
    // keychain-first, so it is the freshest known credential — a stale
    // `.credentials.json` relic that `cpSync` copied must not shadow it, or the
    // profile would migrate onto a dead token (round-2 review F2).
    if (cred) {
      store.clearStale(newConfig);
      fs.writeFileSync(path.join(newConfig, ".credentials.json"), cred, { mode: 0o600 });
    }

    store.removeEntry(oldConfig); // drop the stale old-path keychain entry (darwin)
    fs.rmSync(oldProfile, { recursive: true, force: true });
    moved.push(entry.name);
  }

  // Drop the marker only when no legacy profile dir remains (a name clash may
  // have left one for the user to resolve — then re-scan next time).
  const stillLegacy = fs
    .readdirSync(ROOT, { withFileTypes: true })
    .some((e) => e.isDirectory() && !isProviderId(e.name) && fs.existsSync(path.join(ROOT, e.name, "config")));
  if (!stillLegacy) {
    try {
      fs.writeFileSync(LAYOUT_MARKER, "2\n", { mode: 0o600 });
    } catch {
      /* best-effort — a missing marker only costs a re-scan */
    }
  }
  return moved;
}

export function readJson(p: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}
