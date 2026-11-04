/**
 * Profile lifecycle commands: add, login, browsers, import, use, deactivate,
 * run, list, current, whoami, remove, label, mark-shared, disable/enable,
 * activate, color, rename.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import {
  HOME,
  configDir,
  die,
  ensureRoot,
  identity,
  listProfiles,
  profileDir,
  profileExists,
  readJson,
  requireProfile,
  activeFor,
  setActive,
  labelFor,
  setLabel,
  clearLabel,
  colorOf,
  isDisabled,
  setSharesDefaultLogin,
  sharesDefaultLogin,
  setDisabled,
  setColor,
  isProfileColor,
  PROFILE_COLORS,
  renameProfile,
  isProfileLabel,
  PROFILE_LABELS,
  readProviders,
  ROOT,
} from "../profiles.js";
import { browserWrapperScript, defaultBrowserDeps, listBrowsers, locateBrowser } from "../browsers.js";
import { Provider, ProviderId, PROVIDER_IDS, provider } from "../providers.js";
import { borrowerOf, discardBinding, readBinding, releaseBorrowedAccount } from "../rebind.js";
import { withProperLock } from "../locks.js";
import { renameProtection, forgetProtection } from "../protection.js";
import { renamePoolMember } from "../pools.js";
import { GUARD_REFUSED_EXIT } from "../single-load.js";
import { mappingRows, pruneMappings, setMapping } from "../mappings.js";
import { liveSessionPids } from "../api.js";
import { serviceInstall, serviceTarget } from "../service.js";
import { fileURLToPath } from "node:url";
import { removeLaunchersFor, renameLaunchersFor } from "../launchers.js";
import { newSessionArgs, recordManagedSession, tmuxAvailable, tmuxSessionName } from "../tmux.js";
import {
  CLAUDE_HOME,
  CLAUDE_JSON,
  authStatusFor,
  checkSingleLoad,
  confirmAction,
  credentials,
  launch,
  logActivity,
} from "./shared.js";

export function cmdAdd(providerId: ProviderId, name: string | undefined, browserId?: string): void {
  if (!name) die(`usage: agent-switch add [--provider ${providerId}] <profile> [--browser B]`);
  if (profileExists(providerId, name)) die(`profile "${name}" already exists for ${providerId}`);
  const p = provider(providerId);
  const env = browserId ? browserEnv(browserId, providerId) : {};
  ensureRoot();
  const dir = configDir(providerId, name);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // A bare `claude` in a fresh config dir opens Claude Code's setup screens, not
  // the sign-in; skip them the way `import` does and run the sign-in itself.
  if (providerId === "claude") seedClaudeOnboarding(dir);
  console.log(`Created ${providerId} profile "${name}".`);
  const loginArgs = LOGIN_ARGS[providerId];
  console.log(
    loginArgs.length
      ? `Signing it in with \`${[p.binary, ...loginArgs].join(" ")}\` (finish it in the browser if one opens)...`
      : `Launching ${p.binary} for first login (log in inside if prompted)...`,
  );
  const code = launch(p, name, loginArgs, env);
  const id = identity(providerId, name);
  const after = authStatusFor(providerId, name);
  const ok = !!id || after.state === "connected" || after.state === "expiring";
  logActivity("login", `${providerId}/${name}`, ok ? "signed in (new profile)" : "created, sign-in not confirmed", "user ran `agent-switch add`", ok);
  const flag = providerId === "claude" ? "" : ` --provider ${providerId}`;
  if (!ok && loginArgs.length) {
    console.error(
      `Profile "${name}" was created but is not signed in yet${code !== 0 ? ` (${p.binary} exited with ${code})` : ""}. Finish it with: agent-switch login ${name}${flag}`,
    );
    process.exit(1);
  }
  console.log(id ? `Profile "${name}" is signed in as ${id}.` : ok ? `Profile "${name}" is signed in.` : `Profile "${name}" created.`);
  console.log(`Activate it with: agent-switch use ${name}${flag}`);
}

/** Mark Claude Code's first-run setup as done in a new profile (theme taken
 *  from the default install), so its first start goes straight to work. */
function seedClaudeOnboarding(dir: string): void {
  const file = path.join(dir, ".claude.json");
  const config = (fs.existsSync(file) && readJson(file)) || {};
  const theme = (fs.existsSync(CLAUDE_JSON) && readJson(CLAUDE_JSON)?.theme) || "dark";
  config.hasCompletedOnboarding = true;
  config.theme = config.theme || theme;
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
}

/**
 * `$BROWSER` for a sign-in in one specific browser. Only Claude Code is verified
 * to follow it; codex on macOS opens the system default regardless, so it is
 * told rather than silently ignored.
 */
function browserEnv(browserId: string, providerId: ProviderId): NodeJS.ProcessEnv {
  if (process.platform === "win32") die("--browser is not supported on Windows yet.");
  const deps = defaultBrowserDeps(HOME);
  const located = locateBrowser(browserId, deps);
  if (!located) {
    const installed = listBrowsers(deps).map((b) => b.id).join(", ") || "(none found)";
    die(`browser "${browserId}" is not installed. Installed: ${installed}`);
  }
  if (providerId !== "claude") {
    console.log(`Note: ${provider(providerId).binary} opens your default browser itself. If that is the wrong one, open the link it prints in ${browserId} — the sign-in works from any browser.`);
  }
  if (process.platform !== "darwin") return { BROWSER: located };
  const wrapper = path.join(ROOT, "browsers", browserId);
  fs.mkdirSync(path.dirname(wrapper), { recursive: true, mode: 0o700 });
  fs.writeFileSync(wrapper, browserWrapperScript(located), { mode: 0o700 });
  fs.chmodSync(wrapper, 0o700);
  return { BROWSER: wrapper };
}

export function cmdBrowsers(json: boolean): void {
  const list = listBrowsers(defaultBrowserDeps(HOME));
  if (json) return void console.log(JSON.stringify(list, null, 2));
  if (list.length === 0) return void console.log("No supported browsers found.");
  for (const b of list) console.log(`${b.id.padEnd(16)} ${b.name}`);
}

/** The provider's own sign-in command for an existing profile. Antigravity's
 *  agy has no separate login command; it prompts when it starts signed out. */
const LOGIN_ARGS: Record<ProviderId, string[]> = {
  claude: ["auth", "login"],
  codex: ["login"],
  antigravity: [],
};

/**
 * Sign an existing profile in again — `add` refuses a name that exists, and a
 * login the provider cleared (signed out, refresh window ended) needs exactly
 * this. Runs the provider's own sign-in under the profile's config dir, then
 * reads the stored login back: the identity in the config outlives a sign-out,
 * so only the credential proves the sign-in happened.
 */
export function cmdLogin(providerId: ProviderId, name: string | undefined, browserId?: string): void {
  const n = requireProfile(providerId, name, "login");
  const p = provider(providerId);
  const env = browserId ? browserEnv(browserId, providerId) : {};
  console.log(`Signing ${providerId}/${n} in with \`${[p.binary, ...LOGIN_ARGS[providerId]].join(" ")}\` (finish it in the browser if one opens)...`);
  const code = launch(p, n, LOGIN_ARGS[providerId], env);
  const after = authStatusFor(providerId, n);
  const ok = after.state === "connected" || after.state === "expiring";
  logActivity("login", `${providerId}/${n}`, ok ? "signed in again" : "sign-in not confirmed", "user ran `agent-switch login`", ok);
  if (!ok) {
    console.error(`${providerId}/${n} is still not signed in (${after.detail})${code !== 0 ? ` — ${p.binary} exited with ${code}` : ""}.`);
    process.exit(1);
  }
  // Its own sign-in ends the lineage it shared with the default install.
  if (sharesDefaultLogin(providerId, n)) setSharesDefaultLogin(providerId, n, false);
  const id = identity(providerId, n);
  console.log(`${providerId}/${n} is signed in${id ? ` as ${id}` : ""}.`);
}

/**
 * Login-free import of the default Claude install into a profile. Takes Claude
 * Code's own locks so a credential can't be captured mid-rotation, copies the
 * config, seeds a plaintext .credentials.json (Claude re-migrates it into the
 * profile's hashed keychain entry), and sets the onboarding keys.
 */
async function importClaude(name: string): Promise<void> {
  if (!fs.existsSync(CLAUDE_HOME) && !fs.existsSync(CLAUDE_JSON)) {
    die("no default ~/.claude setup found to import");
  }
  ensureRoot();
  const dst = configDir("claude", name);

  const seeded = await withProperLock(CLAUDE_HOME, () =>
    withProperLock(CLAUDE_JSON, () => {
      credentials.clearStale(dst); // a stale hashed entry would shadow the seed (darwin)
      fs.mkdirSync(dst, { recursive: true, mode: 0o700 });
      if (fs.existsSync(CLAUDE_HOME)) fs.cpSync(CLAUDE_HOME, dst, { recursive: true });

      const config = (fs.existsSync(CLAUDE_JSON) && readJson(CLAUDE_JSON)) || {};
      config.hasCompletedOnboarding = true;
      config.theme = config.theme || "dark";
      fs.writeFileSync(path.join(dst, ".claude.json"), JSON.stringify(config, null, 2) + "\n", {
        mode: 0o600,
      });

      const creds = credentials.readDefault(CLAUDE_HOME);
      if (creds) fs.writeFileSync(path.join(dst, ".credentials.json"), creds, { mode: 0o600 });
      return creds !== null;
    }),
  );
  if (seeded) setSharesDefaultLogin("claude", name, true);

  console.log(`Imported default Claude setup into profile "${name}".`);
  console.log(
    seeded
      ? "Credentials were seeded — no re-login needed. Claude Code migrates the seed into\n" +
          "this profile's own keychain entry on first use.\n" +
          "IMPORTANT: the default install and this profile now share one OAuth lineage — the\n" +
          "first side to refresh invalidates the other, so go through agent-switch from now on."
      : "No live credential found to seed (keychain locked/empty). Run `agent-switch run " +
          `${name}\` once and log in inside.`,
  );
}

/** Import a file-based provider profile (e.g. codex): copy the credential/identity
 *  files from the default install's config dir into the profile's config dir. */
function importFileProvider(p: Provider, name: string): void {
  const srcDir = p.defaultConfigDir();
  if (!fs.existsSync(srcDir)) die(`no default ${p.binary} install (${srcDir}) found to import`);
  const dstDir = p.configDirFor(configDir(p.id, name));
  fs.mkdirSync(dstDir, { recursive: true, mode: 0o700 });

  let seeded = false;
  for (const file of p.importFiles) {
    const src = path.join(srcDir, file);
    if (!fs.existsSync(src)) continue;
    fs.copyFileSync(src, path.join(dstDir, file));
    fs.chmodSync(path.join(dstDir, file), 0o600);
    if (path.join(srcDir, file) === p.credentialPath(srcDir)) seeded = true;
  }
  if (seeded) setSharesDefaultLogin(p.id, name, true);

  console.log(`Imported default ${p.binary} setup into profile "${name}".`);
  console.log(
    seeded
      ? `Credential seeded — no re-login needed.\nIMPORTANT: this profile shares one OAuth ` +
          `lineage with the default ${p.binary} login; go through agent-switch from now on.`
      : `No credential file found to seed. Run \`agent-switch run ${name} --provider ${p.id}\` ` +
          "and log in once.",
  );
}

export async function cmdImport(providerId: ProviderId, name?: string): Promise<void> {
  if (!name) die(`usage: agent-switch import [--provider ${providerId}] <profile>`);
  if (profileExists(providerId, name)) die(`profile "${name}" already exists for ${providerId}`);
  if (providerId === "claude") return importClaude(name);
  return importFileProvider(provider(providerId), name);
}

export function cmdUse(providerId: ProviderId, name?: string): void {
  const n = requireProfile(providerId, name, "use");
  if (isDisabled(providerId, n)) die(`${n} is disabled — turn it back on first: agent-switch enable ${n}${providerId === "claude" ? "" : ` --provider ${providerId}`}`);
  setActive(providerId, n);
  logActivity("switch", `${providerId}/${n}`, "set as active profile", "user ran `agent-switch use`");
  const id = identity(providerId, n);
  console.log(`Active ${providerId} profile: ${n}${id ? ` (${id})` : ""}`);
  console.log(`New \`${provider(providerId).binary}\` sessions use this profile. Running sessions are unaffected.`);

  // `use` loads nothing — it states an intent — so it NEVER blocks. But it is
  // the cheapest possible moment to tell the user that the profile they just
  // pointed at is already busy, before the next start moves or shares it.
  const check = checkSingleLoad(providerId, n, { context: "use" });
  if (check.message) {
    console.log("");
    console.warn(check.message);
  }
}

export function cmdDeactivate(providerId: ProviderId): void {
  const active = activeFor(providerId);
  if (!active) {
    console.log(`No active ${providerId} profile.`);
    return;
  }
  setActive(providerId, null);
  logActivity("switch", `${providerId}/${active}`, "deactivated", "user ran `agent-switch deactivate`");
  console.log(`Deactivated ${providerId} profile "${active}". No ${providerId} profile is active.`);
  console.log(`New \`${provider(providerId).binary}\` sessions fall back to the default install until you \`use\` one.`);
}

export function cmdRun(
  providerId: ProviderId,
  name: string | undefined,
  passthrough: string[],
  cwd?: string,
  own: { tmux?: boolean; force?: boolean } = {},
): void {
  const n = requireProfile(providerId, name, "run");
  if (cwd !== undefined) {
    if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) die(`no such folder: ${cwd}`);
    process.chdir(cwd);
  }
  const p = provider(providerId);
  const wantTmux = !!own.tmux;
  const forced = !!own.force;

  // agent-switch spawns the binary itself here, so this is the strongest
  // enforcement point: refuse before anything is launched.
  const guard = checkSingleLoad(providerId, n, { forced, offerForceFlag: true });
  if (guard.message) console.error(guard.verdict === "refuse" ? `error: ${guard.message}` : guard.message);
  if (guard.verdict === "refuse") process.exit(GUARD_REFUSED_EXIT);

  if (wantTmux) {
    if (!tmuxAvailable()) {
      console.log("(--tmux unavailable — tmux not found or Windows; running normally.)");
    } else {
      // Wrap the session in an agent-switch-managed tmux session (recorded so
      // `takeover --in-place` knows this pane is ours to respawn).
      const sess = tmuxSessionName(providerId, n);
      recordManagedSession(sess, { provider: providerId, profile: n });
      const argv = newSessionArgs(sess, p.envVar, configDir(providerId, n), [p.binary, ...passthrough]);
      const res = spawnSync("tmux", argv, { stdio: "inherit" });
      process.exit(res.status ?? 1);
    }
  }
  process.exit(launch(p, n, passthrough));
}

function printProfileLine(providerId: ProviderId, name: string, showLive: boolean): void {
  const mark = activeFor(providerId) === name ? "*" : " ";
  const id = identity(providerId, name) ?? "not logged in";
  let live = "";
  if (showLive && providerId === "claude") {
    const pids = liveSessionPids(configDir("claude", name));
    // More than one session on one account is the state the single-load guard
    // exists to prevent, so it is marked rather than blending into the count.
    if (pids.length > 1) live = `  ⚠️  [loaded ${pids.length}× — ${pids.length} live sessions]`;
    else if (pids.length === 1) live = "  [1 live session]";
  }
  console.log(`${mark} ${name.padEnd(16)} ${id}${live}`);
}

export function cmdList(providerId?: ProviderId, json = false): void {
  // An explicit --provider always lists that one; otherwise every provider that
  // is enabled on ANY surface. Gating on the CLI surface alone would silently
  // drop a UI-only provider's profiles (e.g. Antigravity, cli:false/ui:true) —
  // the GUI reads `list --json` for every tab, so it must see them too.
  const cfg = readProviders();
  const providers = providerId ? [providerId] : PROVIDER_IDS.filter((p) => cfg[p].cli || cfg[p].ui);

  if (json) {
    // The GUI IPC contract: the profile list (identity/active/live) — NOT usage.
    // Usage stays behind `status --json` (active profile only, anti-rotation).
    const rows = providers.flatMap((pid) =>
      listProfiles(pid).map((n) => ({
        provider: pid,
        name: n,
        identity: identity(pid, n),
        label: labelFor(pid, n),
        color: colorOf(pid, n),
        disabled: isDisabled(pid, n),
        active: activeFor(pid) === n,
        liveSessions: pid === "claude" ? liveSessionPids(configDir("claude", n)).length : 0,
      })),
    );
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  let any = false;
  for (const pid of providers) {
    const names = listProfiles(pid);
    if (names.length === 0) continue;
    any = true;
    console.log(`${pid}:`);
    for (const n of names) {
      process.stdout.write("  ");
      printProfileLine(pid, n, true);
    }
  }
  if (!any) console.log("No profiles yet. Create one with: agent-switch add <name> [--provider codex|antigravity]");
}

export function cmdCurrent(providerId?: ProviderId): void {
  const providers = providerId ? [providerId] : PROVIDER_IDS;
  for (const pid of providers) {
    const active = activeFor(pid);
    if (active && profileExists(pid, active)) {
      const id = identity(pid, active);
      console.log(`${pid}: ${active}${id ? ` (${id})` : ""}`);
    } else if (providerId) {
      console.log(`${pid}: (none — falling back to the default install)`);
    }
  }
}

export function cmdWhoami(providerId: ProviderId, name?: string): void {
  const n = name ?? activeFor(providerId) ?? undefined;
  if (!n) die(`no profile given and none active for ${providerId}`);
  requireProfile(providerId, n, "whoami");
  console.log(identity(providerId, n) ?? "not logged in yet");
}

export async function cmdRemove(providerId: ProviderId, name?: string, force = false, yes = false): Promise<void> {
  const n = requireProfile(providerId, name, "remove");
  if (activeFor(providerId) === n && !force) {
    die(`"${n}" is the active ${providerId} profile. Switch away first or use --force.`);
  }
  if (providerId === "claude") {
    const pids = liveSessionPids(configDir("claude", n));
    if (pids.length > 0 && !force) {
      die(`profile "${n}" has live Claude Code sessions (PIDs ${pids.join(", ")}). Close them or use --force.`);
    }
  }
  // An active rebind keeps both original credentials in two Keychain stash
  // entries. Deleting the profile would orphan them — restore first.
  const binding = providerId === "claude" ? readBinding(configDir("claude", n)) : null;
  if (binding && !force) {
    die(
      `profile "${n}" is rebound to "${binding.boundToProfile}"'s account. Restore it first: ` +
        `agent-switch rebind --restore --profile ${n} — or use --force to drop the rebind (its stashed credentials are deleted).`,
    );
  }

  // The reverse case: another profile is serving THIS profile's account. Its
  // restore would write into the store of a profile that no longer exists.
  const borrower = providerId === "claude" ? borrowerOf(n) : null;
  if (borrower && !force) {
    die(
      `profile "${n}"'s account is currently borrowed by "${borrower}" (rebind). Restore it first: ` +
        `agent-switch rebind --restore --profile ${borrower} — or use --force to restore "${borrower}" and then remove "${n}".`,
    );
  }

  const who = identity(providerId, n);
  if (!(await confirmAction(`Remove ${providerId} profile "${n}"${who ? ` (${who})` : ""} and its login? This cannot be undone.`, yes))) {
    console.log("Cancelled — nothing removed.");
    return;
  }

  // Keychain entries exist only for claude (darwin); codex/antigravity are file-based,
  // so computing a Claude hash for them would be a conceptual no-op — skip it.
  let restoredBorrower: string | null = null;
  if (borrower) {
    try {
      restoredBorrower = await releaseBorrowedAccount(n);
    } catch (e) {
      die(`could not restore "${borrower}" first, so "${n}" was not removed: ${(e as Error).message}`);
    }
    if (restoredBorrower) logActivity("rebind", `claude/${restoredBorrower}`, `restored own account (was on ${n})`, "user ran `agent-switch remove --force`");
  }
  const droppedRebind = binding ? discardBinding(n) : false;
  const removedEntry = providerId === "claude" ? credentials.removeEntry(configDir(providerId, n)) : false;
  removeLaunchersFor(providerId, n); // they would start a profile that no longer exists
  fs.rmSync(profileDir(providerId, n), { recursive: true, force: true });
  if (activeFor(providerId) === n) setActive(providerId, null);
  clearLabel(providerId, n); // drop its label so it can't linger as an orphan
  const pruned = pruneMappings(providerId, n);
  forgetProtection(providerId, n);
  renamePoolMember(`${providerId}/${n}`, null);
  logActivity("remove", `${providerId}/${n}`, "profile removed", yes ? "user ran `agent-switch remove --yes`" : "user ran `agent-switch remove`");

  console.log(`Removed ${providerId} profile "${n}".`);
  if (restoredBorrower) console.log(`Restored "${restoredBorrower}" to its own account first (it was borrowing "${n}").`);
  if (droppedRebind) console.log(`Dropped its active rebind (stashed credentials deleted; "${binding!.boundToProfile}" keeps its own login).`);
  if (removedEntry) console.log("Removed its keychain credential entry.");
  if (pruned.length > 0) console.log(`Removed ${pruned.length} directory mapping(s).`);
}

/** Set or clear a profile's label (Work / Personal / Other). */
export function cmdLabel(providerId: ProviderId, name?: string, label?: string): void {
  // The profile need NOT exist yet: a label is independent state keyed by
  // provider/name, and the GUI sets the tag up front while `add` runs the login
  // in a terminal. Requiring the profile here made that set fail (and the GUI
  // swallowed the error), so a new profile's tag was silently lost.
  if (!name) die(`usage: agent-switch label <profile> [${PROFILE_LABELS.join("|")}|none] [--provider P]`);
  if (label === undefined || label === "none" || label === "clear") {
    setLabel(providerId, name, null);
    console.log(`Cleared label for ${providerId}/${name}.`);
    return;
  }
  if (!isProfileLabel(label)) {
    die(`invalid label "${label}" (choose: ${PROFILE_LABELS.join(", ")}, or "none" to clear)`);
  }
  setLabel(providerId, name, label);
  console.log(`Labeled ${providerId}/${name} as ${label}.`);
}

/** Disable keeps a profile (login, history, settings) but takes it out of every
 *  pick: no active slot, no pool or folder rule, no background polling. */
/** `mark-shared <name> [--off]`: mark (or unmark) a profile as sharing the
 *  default install's login — for imports made before `import` set the mark. */
export function cmdMarkShared(providerId: ProviderId, name: string | undefined, off: boolean): void {
  const n = requireProfile(providerId, name, "mark-shared");
  setSharesDefaultLogin(providerId, n, !off);
  console.log(
    off
      ? `${providerId}/${n} no longer counts as sharing the default install's login.`
      : `${providerId}/${n} now counts as sharing the default install's login: agent-switch never refreshes it and never starts it by balancing. \`agent-switch login ${n}\` gives it its own login.`,
  );
}

export function cmdDisable(providerId: ProviderId, name: string | undefined, disabled: boolean): void {
  const n = requireProfile(providerId, name, disabled ? "disable" : "enable");
  const wasActive = activeFor(providerId) === n;
  setDisabled(providerId, n, disabled);
  if (!disabled) return void console.log(`Turned ${providerId}/${n} back on.`);
  console.log(`Disabled ${providerId}/${n}. Nothing was deleted; \`agent-switch enable ${n}\` turns it back on.`);
  if (wasActive) console.log(`It was the active ${providerId} profile — new sessions now use the default login until you pick another.`);
}

/** Every npm-style install (global, nvm, Windows) lives under a `node_modules`
 *  segment; a build anywhere else is a repo or worktree checkout. */
export function isSourceCheckoutCli(cli: string): boolean {
  return !cli.split(/[\\/]/).includes("node_modules");
}

/**
 * Make this CLI the one terminals and the background service use: the shell
 * wrapper reads <home>/active-cli, and a service installed from the other CLI
 * is re-installed onto this one. An uninstalled service stays so.
 *
 * Every app runs it on start with `auto`. A source-checkout build then claims
 * nothing: launching a dev GUI must not move the everyday terminals and the
 * service onto code that is half-built, gets rebuilt under them, or is deleted
 * with its worktree. Without `auto` it is a deliberate switch and always runs.
 */
export function cmdActivate(json: boolean, auto = false): void {
  // The CLI entry point (dist/index.js), not this module in dist/commands/.
  const cli = fs.realpathSync(fileURLToPath(new URL("../index.js", import.meta.url)));
  if (auto && isSourceCheckoutCli(cli)) {
    let active: string | null = null;
    try {
      active = fs.readFileSync(path.join(ROOT, "active-cli"), "utf8").trim() || null;
    } catch {
      /* never activated */
    }
    if (json) return void console.log(JSON.stringify({ cli, service: "skipped", skipped: "source-checkout", active }));
    console.log(`Left terminals and the service alone: ${cli} is a source checkout.`);
    console.log("Run `agent-switch activate` from it to switch on purpose.");
    return;
  }
  ensureRoot();
  fs.writeFileSync(path.join(ROOT, "active-cli"), `${cli}\n`, { mode: 0o600 });
  const before = serviceTarget();
  if (before === "other-cli") serviceInstall(() => {});
  const service = before === "other-cli" ? "repointed" : before === "this-cli" ? "unchanged" : "not-installed";
  if (json) return void console.log(JSON.stringify({ cli, service }));
  console.log(`Terminals now use ${cli}.`);
  if (service === "repointed") console.log("The background service was moved onto it.");
  if (service === "not-installed") console.log("The background service isn't installed (agent-switch service install).");
}

export function cmdColor(providerId: ProviderId, name?: string, color?: string): void {
  // Like a label, independent state keyed by provider/name: the GUI picks the
  // colour before `add` has created the profile.
  if (!name) die(`usage: agent-switch color <profile> [${PROFILE_COLORS.join("|")}|none] [--provider P]`);
  if (color === undefined || color === "none" || color === "clear") {
    setColor(providerId, name, null);
    console.log(`Cleared the colour of ${providerId}/${name}.`);
    return;
  }
  if (!isProfileColor(color)) die(`invalid colour "${color}" (choose: ${PROFILE_COLORS.join(", ")}, or "none" to clear)`);
  setColor(providerId, name, color);
  console.log(`Coloured ${providerId}/${name} ${color}.`);
}

/** Enable/disable opt-in near-limit notifications (notify + suggest, never an
 *  automatic switch), or show the current setting. */
/** Rename a profile (move its config dir + carry active/label/mappings). */
export function cmdRename(providerId: ProviderId, from?: string, to?: string): void {
  const n = requireProfile(providerId, from, "rename");
  if (!to) die("usage: agent-switch rename <old> <new> [--provider P]");
  if (!/^[A-Za-z0-9._-]+$/.test(to)) {
    die("new name may contain only letters, numbers, dots, dashes and underscores.");
  }
  if (to === n) return; // no-op
  if (profileExists(providerId, to)) die(`profile "${to}" already exists for ${providerId}.`);
  if (providerId === "claude") {
    const pids = liveSessionPids(configDir("claude", n));
    if (pids.length > 0) die(`profile "${n}" has live Claude sessions (PIDs ${pids.join(", ")}). Close them first.`);
  }
  try {
    renameProfile(providerId, n, to);
  } catch (err: any) {
    die(String(err?.message ?? err));
  }
  for (const m of mappingRows()) {
    if (m.provider === providerId && m.name === n) setMapping(m.path, providerId, to);
  }
  renameProtection(providerId, n, to);
  renamePoolMember(`${providerId}/${n}`, `${providerId}/${to}`);
  renameLaunchersFor(providerId, n, to);
  console.log(`Renamed ${providerId} profile "${n}" → "${to}".`);
}
