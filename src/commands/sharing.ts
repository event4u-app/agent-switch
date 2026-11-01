/**
 * Cross-profile config: share (history/settings links) and config export/import.
 */

import * as fs from "node:fs";
import { configDir, die, listProfiles, requireProfile } from "../profiles.js";
import { applySharing, removeSharing, syncSharing, sharedLinkHealth, PROMPT_HISTORY } from "../share.js";
import { assertNotFull, exportConfig, importConfig } from "../config-transfer.js";
import { CLAUDE_HOME } from "./shared.js";

// share + web are Claude-config concepts and stay Claude-scoped.
export function cmdShare(mode?: string, flags: string[] = []): void {
  const withHistory = flags.includes("--history");
  const sourceFlagIdx = flags.indexOf("--source");
  const sourceName = sourceFlagIdx >= 0 ? flags[sourceFlagIdx + 1] : undefined;
  const source =
    sourceName && sourceName !== "default"
      ? configDir("claude", requireProfile("claude", sourceName, "share --source"))
      : CLAUDE_HOME;

  const profiles = listProfiles("claude");
  if (profiles.length === 0) die("no claude profiles");

  if (mode === "on") {
    if (!fs.existsSync(source)) die(`share source ${source} does not exist`);
    if (withHistory && process.platform === "win32") {
      die("--history requires POSIX symlinks (copies would fork history, not share it)");
    }
    console.log(`Sharing from ${source}${withHistory ? " (incl. history)" : ""}:`);
    for (const p of profiles) {
      if (configDir("claude", p) === source) continue;
      const actions = applySharing(source, configDir("claude", p), withHistory);
      console.log(`  ${p}: ${actions.length > 0 ? actions.join(", ") : "up to date"}`);
    }
    console.log(
      "Prompt history (history.jsonl — what ↑ and Ctrl+R search) is shared too; a profile's own\n" +
        "file was merged in and kept as history.jsonl.pre-share.\n" +
        "Shared directories (skills/, commands/, agents/) write through the link. Shared files\n" +
        "(settings.json, ...) fork on an in-profile /config edit — run `agent-switch share sync`\n" +
        "to push a fork back to the source and re-link.",
    );
  } else if (mode === "sync") {
    console.log(`Reconciling forked links against ${source}:`);
    for (const p of profiles) {
      if (configDir("claude", p) === source) continue;
      const actions = syncSharing(source, configDir("claude", p));
      console.log(`  ${p}: ${actions.length > 0 ? actions.join(", ") : "nothing to reconcile"}`);
    }
  } else if (mode === "off") {
    for (const p of profiles) {
      const actions = removeSharing(configDir("claude", p));
      if (actions.length > 0) console.log(`  ${p}: ${actions.join(", ")}`);
    }
    console.log("Removed agent-switch-managed links (profile-own files were never touched).");
  } else if (mode === "status") {
    // Report the REAL state (from each profile's link manifest), not a cached
    // flag: sharing is active when any profile carries agent-switch-managed links.
    const rows = profiles
      .filter((p) => configDir("claude", p) !== source)
      .map((p) => {
        const links = sharedLinkHealth(configDir("claude", p));
        const prompts = links.some((l) => l.name === PROMPT_HISTORY && l.state === "linked");
        return { name: p, shared: links.length > 0, prompts };
      });
    const active = rows.some((r) => r.shared);
    if (flags.includes("--json")) {
      console.log(JSON.stringify({ active, source: sourceName ?? "default", profiles: rows }));
      return;
    }
    console.log(`share: ${active ? "on" : "off"} (source ${sourceName ?? "default"})`);
    for (const r of rows) console.log(`  ${r.name}: ${r.shared ? "shared" : "own"}${r.shared && !r.prompts ? " (prompt history not linked — run share on)" : ""}`);
  } else {
    die("usage: agent-switch share on|sync|off|status [--history] [--source <profile|default>]");
  }
}

/**
 * `agent-switch config export|import <profile> [--full]` — move a Claude
 * profile's SHARED config (settings.json, keybindings.json, CLAUDE.md, skills/,
 * commands/, agents/) between machines as a JSON bundle. Config-ONLY — it never
 * touches credentials. Claude-scoped (config lives under the Claude layout).
 *
 *   export → the bundle goes to STDOUT (pipe it: `| gpg -c > backup.gpg`), all
 *            status on STDERR so stdout stays a clean bundle.
 *   import → reads a bundle from STDIN into the profile's config dir.
 *   --full → REFUSED (would bundle live OAuth tokens; account-takeover vector).
 */
export function cmdConfig(sub?: string, name?: string, flags: Record<string, string | boolean> = {}): void {
  try {
    assertNotFull(!!flags.full);
  } catch (e) {
    die((e as Error).message);
  }

  if (sub === "export") {
    const n = requireProfile("claude", name, "config export");
    const bundle = exportConfig(configDir("claude", n));
    // Status on stderr — stdout is the bundle (so `... | gpg -c > backup.gpg` works).
    console.error(`Exported config-only bundle for claude/${n} (SHARED_ITEMS allowlist; no credentials).`);
    process.stdout.write(bundle + "\n");
    return;
  }

  if (sub === "import") {
    const n = requireProfile("claude", name, "config import");
    let input: string;
    try {
      input = fs.readFileSync(0, "utf8"); // stdin
    } catch {
      die("config import reads a bundle from stdin — pipe one in (e.g. `gpg -d backup.gpg | agent-switch config import <profile>`).");
    }
    let written: string[];
    try {
      written = importConfig(configDir("claude", n), input);
    } catch (e) {
      die((e as Error).message);
    }
    console.error(`Imported ${written.length} config file(s) into claude/${n} (config-only; no credentials):`);
    for (const w of written) console.error(`  ${w}`);
    return;
  }

  die("usage: agent-switch config export|import <profile>   (config-only; pipe export | gpg -c > backup.gpg)");
}
