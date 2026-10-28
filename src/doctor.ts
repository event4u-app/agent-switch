/**
 * `agent-switch doctor [--json]` — a per-OS, per-provider self-check.
 *
 * Every finding is a {@link DoctorCheck} (`id, status, title, detail, fix?`);
 * the text output and `--json` render the same list. The exit code is 1 only
 * on a hard error (a provider with profiles but no binary). Read-only — it never
 * mutates a profile, and it never prints a credential or an env var's value.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ROOT, activeFor, configDir, identity, listProfiles, profileExists, readGuard } from "./profiles.js";
import { Provider, ProviderId, allProviders } from "./providers.js";
import { credentialStore } from "./credentials.js";
import { sharedLinkHealth } from "./share.js";
import { checkAuth, liveSessionPids, type AuthState } from "./api.js";
import { checkTooling, doctorToolingLine } from "./tooling.js";
import { readGuiSettings, type GuiSettings } from "./gui-settings.js";

export type CheckStatus = "ok" | "warn" | "error" | "info";

export interface DoctorCheck {
  id: string;
  status: CheckStatus;
  title: string;
  detail: string;
  fix?: string;
}

export interface DoctorReport {
  /** `ready` = nothing to do · `attention` = warnings · `blocked` = a hard error. */
  readiness: "ready" | "attention" | "blocked";
  platform: NodeJS.Platform;
  checks: DoctorCheck[];
}

/**
 * Env vars that make a provider CLI ignore the profile's login and use a key
 * or token from the environment instead (D5) — the same credential in every
 * profile, often billed per use. Only the NAMES are ever reported.
 */
export const AUTH_OVERRIDE_ENV: Record<string, ProviderId> = {
  ANTHROPIC_API_KEY: "claude",
  ANTHROPIC_AUTH_TOKEN: "claude",
  CLAUDE_CODE_OAUTH_TOKEN: "claude",
  OPENAI_API_KEY: "codex",
  CODEX_API_KEY: "codex",
  GEMINI_API_KEY: "antigravity",
  GOOGLE_API_KEY: "antigravity",
};

export function apiKeyOverrideCheck(env: NodeJS.ProcessEnv = process.env): DoctorCheck {
  const set = Object.keys(AUTH_OVERRIDE_ENV).filter((k) => typeof env[k] === "string" && env[k] !== "");
  if (set.length === 0) {
    return { id: "api-key-overrides", status: "ok", title: "No API-key overrides", detail: "No provider key or token is set in the environment, so each profile uses its own login." };
  }
  const which = set.map((k) => `${k} (${AUTH_OVERRIDE_ENV[k]})`).join(", ");
  return {
    id: "api-key-overrides",
    status: "warn",
    title: "API key overrides profile logins",
    detail: `${which} is set in the environment agent-switch runs in. The provider uses it instead of the profile's login — the same credential in every profile, usually billed per use.`,
    fix: `Unset it in your shell profile (e.g. \`unset ${set[0]}\`) unless you mean to use a key.`,
  };
}

/** Is `agent-switch` reachable on PATH (the shell wrapper and the GUI call it by name)? */
export function cliOnPathCheck(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, exists: (p: string) => boolean = fs.existsSync): DoctorCheck {
  const dirs = (env.PATH ?? env.Path ?? "").split(platform === "win32" ? ";" : ":").filter(Boolean);
  const names = platform === "win32" ? ["agent-switch.cmd", "agent-switch.exe", "agent-switch"] : ["agent-switch"];
  const hit = dirs.flatMap((d) => names.map((n) => path.join(d, n))).find(exists);
  return hit
    ? { id: "cli-on-path", status: "ok", title: "agent-switch is on PATH", detail: hit }
    : {
        id: "cli-on-path",
        status: "warn",
        title: "agent-switch is not on PATH",
        detail: "The shell wrapper and the desktop app call `agent-switch` by name.",
        fix: "npm install -g @event4u/agent-switch",
      };
}

function rcCandidates(home: string): string[] {
  return [
    path.join(home, ".zshrc"),
    path.join(home, ".bashrc"),
    path.join(home, ".bash_profile"),
    path.join(home, ".profile"),
    path.join(home, ".config", "fish", "config.fish"),
    path.join(home, "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1"),
    path.join(home, "Documents", "WindowsPowerShell", "Microsoft.PowerShell_profile.ps1"),
  ];
}

export function shellIntegrationCheck(home: string = os.homedir(), read: (p: string) => string | null = readOrNull): DoctorCheck {
  const found = rcCandidates(home).find((f) => /agent-switch\s+shellenv/.test(read(f) ?? ""));
  return found
    ? { id: "shell-integration", status: "ok", title: "Shell integration installed", detail: `Loaded from ${found}.` }
    : {
        id: "shell-integration",
        status: "warn",
        title: "Shell integration not found",
        detail: "Without it, `claude`/`codex`/`agy` in a terminal ignore the active profile and folder rules. (Checked the usual zsh, bash, fish and PowerShell profile files.)",
        fix: 'Add `eval "$(agent-switch shellenv)"` to your shell profile (see `agent-switch shellenv --help`).',
      };
}

export function autostartCheck(s: GuiSettings): DoctorCheck {
  const a = s.autostart;
  if (a.state === "enabled") {
    return { id: "autostart", status: "ok", title: "Starts at login", detail: a.by === "user" ? "Turned on by you." : "On by default since the first launch." };
  }
  if (a.state === "disabled") {
    return { id: "autostart", status: "info", title: "Does not start at login", detail: "Turned off by you; updates keep it off." };
  }
  if (s.autostartDegraded) {
    return {
      id: "autostart",
      status: "warn",
      title: "Start at login could not be confirmed",
      detail: `The desktop app tried to turn it on but the system did not confirm it (${s.autostartDegraded.reason}). It retries on the next launch.`,
      fix: "Open the desktop app → Settings → turn on start at login.",
    };
  }
  return { id: "autostart", status: "info", title: "Start at login not set up yet", detail: "The desktop app turns it on at its first launch (default on)." };
}

export function antigravityOsCheck(platform: NodeJS.Platform = process.platform): DoctorCheck {
  return platform === "darwin"
    ? { id: "antigravity-os", status: "ok", title: "Antigravity supported on this OS", detail: "Per-profile keychain and account readout work on macOS." }
    : {
        id: "antigravity-os",
        status: "warn",
        title: "Antigravity is only partly supported here",
        detail: `On ${platform} agent-switch isolates agy's HOME per profile but cannot read which account is signed in or seed a per-profile keychain — both are macOS-only today.`,
      };
}

/** Two profiles of one provider signed into the same account defeat the isolation. */
export function signInIsolationCheck(rows: { provider: ProviderId; name: string; identity: string | null }[]): DoctorCheck {
  const seen = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.identity) continue;
    const k = `${r.provider}\u0000${r.identity.toLowerCase()}`;
    seen.set(k, [...(seen.get(k) ?? []), `${r.provider}/${r.name}`]);
  }
  const dupes = [...seen.values()].filter((v) => v.length > 1);
  if (dupes.length === 0) {
    return { id: "sign-in-isolation", status: "ok", title: "Each profile has its own account", detail: "No two profiles of one provider are signed into the same account (where the account is readable)." };
  }
  return {
    id: "sign-in-isolation",
    status: "warn",
    title: "Profiles share an account",
    detail: `Signed into the same account: ${dupes.map((d) => d.join(" + ")).join("; ")}. They share one set of usage limits.`,
    fix: "Sign one of them into a different account, or remove the duplicate.",
  };
}

function readOrNull(p: string): string | null {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

function binaryOnPath(binary: string): "yes" | "no" | "error" {
  // Timeout so a hung binary can't hang the doctor.
  const probe = spawnSync(binary, ["--version"], { stdio: "ignore", timeout: 5000 });
  if ((probe.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return "no";
  if (probe.error) return "error";
  return "yes";
}

function credentialReadable(p: Provider, name: string): boolean {
  const cfg = p.configDirFor(configDir(p.id, name));
  if (p.id === "claude") return credentialStore().read(cfg) !== null;
  try {
    fs.accessSync(p.credentialPath(cfg));
    return true;
  } catch {
    return false;
  }
}

async function providerChecks(checks: DoctorCheck[]): Promise<void> {
  for (const p of allProviders()) {
    const names = listProfiles(p.id);
    const onPath = binaryOnPath(p.binary);
    const addHint = `agent-switch add <name>${p.id === "claude" ? "" : ` --provider ${p.id}`}`;

    if (onPath === "no") {
      checks.push(
        names.length > 0
          ? { id: `binary-${p.id}`, status: "error", title: `\`${p.binary}\` not on PATH`, detail: `${names.length} ${p.id} profile(s) exist but the CLI is missing.`, fix: `Install ${p.id}, or link it: agent-switch providers link --provider ${p.id} --path <path>` }
          : { id: `binary-${p.id}`, status: "info", title: `\`${p.binary}\` not on PATH`, detail: `No ${p.id} profiles yet — fine unless you use ${p.id}.` },
      );
      continue;
    }
    checks.push(
      onPath === "error"
        ? { id: `binary-${p.id}`, status: "warn", title: `Could not probe \`${p.binary} --version\``, detail: "The binary exists but did not answer." }
        : { id: `binary-${p.id}`, status: "ok", title: `\`${p.binary}\` is on PATH`, detail: "" },
    );

    if (names.length === 0) {
      checks.push({ id: `profiles-${p.id}`, status: "info", title: `No ${p.id} profiles yet`, detail: "", fix: addHint });
      continue;
    }
    checks.push({ id: `profiles-${p.id}`, status: "ok", title: `${names.length} ${p.id} profile(s)`, detail: names.join(", ") });

    const active = activeFor(p.id);
    if (active && !profileExists(p.id, active)) {
      checks.push({ id: `active-${p.id}`, status: "warn", title: `Active ${p.id} profile "${active}" no longer exists`, detail: "", fix: `agent-switch use <name>${p.id === "claude" ? "" : ` --provider ${p.id}`}` });
    }
    // Login validity (Claude only): probe readable credentials in parallel.
    // Read-only; offline / transient degrades to a neutral note, never a WARN.
    const authByName = new Map<string, AuthState>();
    if (p.id === "claude") {
      const readable = names.filter((n) => credentialReadable(p, n));
      const states = await Promise.all(readable.map((n) => checkAuth(p.configDirFor(configDir(p.id, n)))));
      readable.forEach((n, i) => authByName.set(n, states[i]));
    }
    for (const n of names) {
      const id = `login-${p.id}-${n}`;
      const run = `agent-switch run ${n}${p.id === "claude" ? "" : ` --provider ${p.id}`}`;
      if (!credentialReadable(p, n)) {
        checks.push({ id, status: "warn", title: `${p.id}/${n}: no readable login`, detail: "", fix: `${run} and sign in` });
        continue;
      }
      const auth = authByName.get(n);
      if (auth === "expired") checks.push({ id, status: "warn", title: `${p.id}/${n}: login expired`, detail: "", fix: `${run} and /login again` });
      else if (auth === "ok") checks.push({ id, status: "ok", title: `${p.id}/${n}: login valid`, detail: "" });
      else checks.push({ id, status: "ok", title: `${p.id}/${n}: login stored`, detail: p.id === "claude" ? "Not verified — offline?" : "" });
    }
  }
}

export async function collectDoctorReport(): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  checks.push(cliOnPathCheck());
  checks.push(shellIntegrationCheck());
  checks.push(autostartCheck(readGuiSettings()));
  checks.push(apiKeyOverrideCheck());
  checks.push(antigravityOsCheck());

  await providerChecks(checks);

  const identities = allProviders().flatMap((p) => listProfiles(p.id).map((n) => ({ provider: p.id, name: n, identity: identity(p.id, n) })));
  checks.push(signInIsolationCheck(identities));

  // Share-link health (Claude-config sharing).
  for (const n of listProfiles("claude")) {
    const health = sharedLinkHealth(configDir("claude", n));
    if (health.length === 0) continue;
    const forked = health.filter((h) => h.state === "forked").map((h) => h.name);
    const missing = health.filter((h) => h.state === "missing").map((h) => h.name);
    if (forked.length === 0 && missing.length === 0) {
      checks.push({ id: `share-${n}`, status: "ok", title: `claude/${n}: ${health.length} shared link(s) intact`, detail: "" });
    } else {
      const parts = [forked.length ? `forked: ${forked.join(", ")}` : "", missing.length ? `missing: ${missing.join(", ")}` : ""].filter(Boolean);
      checks.push({ id: `share-${n}`, status: "warn", title: `claude/${n}: shared links drifted`, detail: parts.join("; "), fix: "agent-switch share sync" });
    }
  }

  // Single-load guard: the policy, and whether any profile is doubled RIGHT NOW.
  const policy = readGuard();
  checks.push({ id: "guard", status: policy === "off" ? "warn" : "ok", title: `Single-load guard: ${policy}`, detail: policy === "off" ? "A profile can be loaded twice." : "" });
  const doubled: string[] = [];
  for (const p of allProviders()) {
    if (!p.hasLiveSessionSignal) continue;
    for (const n of listProfiles(p.id)) {
      const count = liveSessionPids(configDir(p.id, n)).length;
      if (count > 1) doubled.push(`${p.id}/${n} (${count} sessions)`);
    }
  }
  if (doubled.length > 0) {
    checks.push({ id: "guard-doubled", status: "warn", title: "A profile is loaded more than once", detail: `${doubled.join(", ")} — they share one account's rate limits.` });
  }

  // Ecosystem tooling (agent-config + rtk) — both optional, so never an error.
  for (const t of checkTooling({ ids: ["agent-config", "rtk"] })) {
    checks.push({ id: `tooling-${t.id}`, status: t.healthy ? "ok" : "warn", title: doctorToolingLine(t), detail: "" });
  }

  const readiness = checks.some((c) => c.status === "error") ? "blocked" : checks.some((c) => c.status === "warn") ? "attention" : "ready";
  return { readiness, platform: process.platform, checks };
}

const MARK: Record<CheckStatus, string> = { ok: "✅", warn: "⚠️", error: "❌", info: "ℹ️" };

export async function runDoctor(json = false): Promise<number> {
  const report = await collectDoctorReport();
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return report.readiness === "blocked" ? 1 : 0;
  }
  console.log(`agent-switch doctor — platform ${process.platform}, node ${process.version}`);
  console.log(
    process.platform === "darwin"
      ? "  claude credential store: macOS Keychain (hashed per config dir), file fallback"
      : "  claude credential store: plaintext .credentials.json per profile",
  );
  console.log("");
  for (const c of report.checks) {
    console.log(`${MARK[c.status]}  ${c.title}${c.detail ? ` — ${c.detail}` : ""}`);
    if (c.fix) console.log(`     fix: ${c.fix}`);
  }
  console.log(`\n  profile root: ${ROOT}`);
  console.log("");
  const blocked = report.readiness === "blocked";
  console.log(`${blocked ? MARK.error : MARK.ok}  ${blocked ? "doctor found a blocking problem (see above)." : "no blocking problems."}`);
  return blocked ? 1 : 0;
}
