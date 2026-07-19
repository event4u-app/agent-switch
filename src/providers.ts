/**
 * Provider abstraction — the per-CLI-assistant differences behind one interface.
 *
 * All three tools use the same isolation architecture (one config dir per
 * account via an env var), but differ in:
 *   - the env var name and what it points at (claude/codex: the dir itself;
 *     antigravity: HOME, under which the CLI nests `.gemini/antigravity-cli`);
 *   - where the credential/identity lives inside the config dir;
 *   - the one-shot invocation.
 *
 * Contracts verified live against real installs:
 *   claude       CLAUDE_CONFIG_DIR = dir  · Keychain (macOS)/.credentials.json · `claude -p`
 *   codex        CODEX_HOME        = dir  · $dir/auth.json (0600)              · `codex exec`
 *   antigravity  HOME              = home · $home/.gemini/{google_accounts,oauth_creds}.json · `agy --print`
 *
 * Everything is read-only + best-effort: unreadable identity returns null.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type ProviderId = "claude" | "codex" | "antigravity";
export const PROVIDER_IDS: readonly ProviderId[] = ["claude", "codex", "antigravity"];

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
   * we export (`<root>/<provider>/<name>/config`). antigravity nests a
   * `.gemini/antigravity-cli` subdir; claude/codex use the exported dir directly.
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
   * list is empty; codex just carries its credential/identity files.
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

/**
 * Extract the signed-in email from an `agy` go-keyring keychain value. go-keyring
 * stores the token blob as `go-keyring-base64:<base64(JSON)>`; the JSON carries an
 * OAuth `id_token` (JWT) whose `email` claim is the account. Pure + best-effort,
 * so it is unit-testable and returns null on any shape it does not recognise.
 */
export function decodeGoKeyringEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const prefix = "go-keyring-base64:";
    const b64 = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
    const obj = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    const idToken = obj?.id_token ?? obj?.token?.id_token ?? obj?.tokens?.id_token;
    return emailFromJwt(typeof idToken === "string" ? idToken : undefined);
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
  hasUsageReadout: true, // live via wham/usage (ChatGPT backend)
};

const antigravity: Provider = {
  id: "antigravity",
  binary: "agy",
  // HOME is the isolation lever: agy keeps its config under $HOME/.gemini/ AND
  // stores its OAuth token in the macOS keychain via go-keyring (fixed key
  // service "gemini"/account "antigravity"). Because the keychain default +
  // search list are HOME-scoped, pointing HOME at a per-profile dir — plus
  // seeding a keychain there (see agy-keychain.ts) — isolates the token per
  // account with no global keychain mutation.
  envVar: "HOME",
  // The exported dir IS the HOME; identity/keychain ops run `security` under it.
  configDirFor: (dir) => dir,
  defaultConfigDir: () => os.homedir(),
  // The per-profile keychain file that holds agy's token (under the profile HOME).
  credentialPath: (dir) => path.join(dir, "Library", "Keychains", "login.keychain-db"),
  // Account identity: agy's token lives in the profile keychain; read it via
  // `security` under this HOME and decode the email from its id_token.
  readIdentity: (home) => {
    if (process.platform !== "darwin") return null;
    const r = spawnSync("security", ["find-generic-password", "-s", "gemini", "-wa", "antigravity"], {
      // Pin CFFIXED_USER_HOME with HOME so CoreFoundation reads the profile's
      // keychain, not an ambient home (see agy-keychain.ts for the rationale).
      env: { ...process.env, HOME: home, CFFIXED_USER_HOME: home },
      encoding: "utf8",
      timeout: 10000,
    });
    return decodeGoKeyringEmail(r.stdout?.trim() || null);
  },
  oneShotArgs: (prompt) => ["--print", prompt],
  importFiles: [],
  hasUsageReadout: false,
};

const PROVIDERS: Record<ProviderId, Provider> = { claude, codex, antigravity };

export function provider(id: ProviderId): Provider {
  return PROVIDERS[id];
}

export function allProviders(): Provider[] {
  return PROVIDER_IDS.map((id) => PROVIDERS[id]);
}

/** Where an installer may drop a binary off the default PATH. Some CLIs (e.g.
 *  agy, installed via `curl … | bash`) land in ~/.local/bin, which a GUI app's
 *  minimal PATH frequently omits. */
function localBinary(binary: string): string {
  return path.join(os.homedir(), ".local", "bin", binary);
}

/**
 * Resolve a CLI binary to an invocable command: its bare name when it is on
 * PATH, otherwise its ~/.local/bin path when the binary lives there (GUI apps
 * often run with a minimal PATH that omits it), otherwise the bare name so the
 * caller surfaces a clean "not found" error.
 */
export function resolveBinary(binary: string): string {
  const probe = spawnSync(binary, ["--version"], { stdio: "ignore", timeout: 5000 });
  if ((probe.error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") return binary;
  const local = localBinary(binary);
  return fs.existsSync(local) ? local : binary;
}

/**
 * Best-effort: is this provider's CLI binary installed? Probes `<binary>
 * --version` on PATH and treats only ENOENT as not-installed (a non-zero exit or
 * a timeout still means the binary exists), then falls back to the ~/.local/bin
 * install location. Used to gate enabling a provider the user hasn't installed.
 */
export function isProviderInstalled(id: ProviderId): boolean {
  const bin = PROVIDERS[id].binary;
  const probe = spawnSync(bin, ["--version"], { stdio: "ignore", timeout: 5000 });
  if ((probe.error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") return true;
  return fs.existsSync(localBinary(bin));
}
