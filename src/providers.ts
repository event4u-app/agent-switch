/**
 * Provider abstraction — the per-CLI-assistant differences behind one interface.
 *
 * All three tools use the same isolation architecture (one config dir per
 * account via an env var), but differ in:
 *   - the env var name and what it points at (claude/codex: the dir itself;
 *     gemini: the PARENT of a `.gemini` config subdir);
 *   - where the credential/identity lives inside the config dir;
 *   - the one-shot invocation.
 *
 * Contracts verified live (2026-07-13) against real installs:
 *   claude  CLAUDE_CONFIG_DIR = dir      · Keychain (macOS)/.credentials.json · `claude -p`
 *   codex   CODEX_HOME        = dir      · $dir/auth.json (0600)              · `codex exec`
 *   gemini  GEMINI_CLI_HOME   = parent   · $parent/.gemini/oauth_creds.json   · `gemini -p --output-format json`
 *
 * Everything is read-only + best-effort: unreadable identity returns null.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type ProviderId = "claude" | "codex" | "gemini";
export const PROVIDER_IDS: readonly ProviderId[] = ["claude", "codex", "gemini"];

export function isProviderId(s: string): s is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(s);
}

export interface Provider {
  readonly id: ProviderId;
  /** The CLI binary name. */
  readonly binary: string;
  /** The env var that isolates this tool's config to a directory. */
  readonly envVar: string;
  /**
   * The credential/identity directory for a profile, given the env-var VALUE
   * we export (`<root>/<provider>/<name>/config`). gemini nests a `.gemini`
   * subdir; claude/codex use the exported dir directly.
   */
  configDirFor(exportedDir: string): string;
  /** The default install's credential/identity dir (the `import` source). */
  defaultConfigDir(): string;
  /** Absolute path of the plaintext credential file inside a config dir. */
  credentialPath(configDir: string): string;
  /** Best-effort account identity (email / id); null if unreadable. */
  readIdentity(configDir: string): string | null;
  /** Args for a one-shot prompt invocation of the binary. */
  oneShotArgs(prompt: string): string[];
  /**
   * Files (relative to the config dir) to copy from the default install when
   * importing a profile. claude is special-cased (locks + onboarding), so its
   * list is empty; codex/gemini just carry their credential/identity files.
   */
  readonly importFiles: readonly string[];
  /**
   * Whether this provider exposes a usage/quota readout agent-switch can read.
   * Only `true` for Claude (its OAuth `/usage` endpoint). Auto-switch is offered
   * ONLY for providers with a readout — there is nothing to trigger on otherwise.
   */
  readonly hasUsageReadout: boolean;
}

function readJson(p: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

/** Decode the `email` claim from a JWT id_token, best-effort. */
function emailFromJwt(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const payload = idToken.split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof json?.email === "string" ? json.email : null;
  } catch {
    return null;
  }
}

const claude: Provider = {
  id: "claude",
  binary: "claude",
  envVar: "CLAUDE_CONFIG_DIR",
  configDirFor: (dir) => dir,
  defaultConfigDir: () => path.join(os.homedir(), ".claude"),
  credentialPath: (dir) => path.join(dir, ".credentials.json"),
  readIdentity: (dir) => readJson(path.join(dir, ".claude.json"))?.oauthAccount?.emailAddress ?? null,
  oneShotArgs: (prompt) => ["-p", prompt],
  importFiles: [],
  hasUsageReadout: true,
};

const codex: Provider = {
  id: "codex",
  binary: "codex",
  envVar: "CODEX_HOME",
  configDirFor: (dir) => dir,
  defaultConfigDir: () => path.join(os.homedir(), ".codex"),
  credentialPath: (dir) => path.join(dir, "auth.json"),
  readIdentity: (dir) => {
    const auth = readJson(path.join(dir, "auth.json"));
    if (!auth) return null;
    // Prefer the id_token's email claim; fall back to the opaque account id.
    return emailFromJwt(auth?.tokens?.id_token) ?? auth?.tokens?.account_id ?? null;
  },
  oneShotArgs: (prompt) => ["exec", prompt],
  importFiles: ["auth.json"],
  hasUsageReadout: false,
};

const gemini: Provider = {
  id: "gemini",
  binary: "gemini",
  envVar: "GEMINI_CLI_HOME",
  // The env var names the PARENT; gemini keeps its state in a `.gemini` subdir.
  configDirFor: (dir) => path.join(dir, ".gemini"),
  // The default install writes straight into ~/.gemini (no nested .gemini).
  defaultConfigDir: () => path.join(os.homedir(), ".gemini"),
  credentialPath: (dir) => path.join(dir, "oauth_creds.json"),
  readIdentity: (dir) => readJson(path.join(dir, "google_accounts.json"))?.active ?? null,
  oneShotArgs: (prompt) => ["-p", prompt, "--output-format", "json"],
  importFiles: ["oauth_creds.json", "google_accounts.json"],
  hasUsageReadout: false,
};

const PROVIDERS: Record<ProviderId, Provider> = { claude, codex, gemini };

export function provider(id: ProviderId): Provider {
  return PROVIDERS[id];
}

export function allProviders(): Provider[] {
  return PROVIDER_IDS.map((id) => PROVIDERS[id]);
}
