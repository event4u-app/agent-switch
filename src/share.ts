/**
 * Share user-level settings across profiles via symlinks.
 *
 * Mechanism adopted from claude-swap (session.py): Claude Code's settings
 * writer detects symlinks and writes through to the target, so linking
 * settings.json etc. from a source dir into each profile gives one shared
 * configuration — in-session `/config` changes land in the source for
 * everyone. Deliberately excludes anything account- or instance-scoped
 * (.claude.json, .credentials.json, plugins/, sessions/, ide/, statsig/).
 *
 * A manifest (.agent-switch-shared.json) records what we created, so unshare and
 * re-sync only ever remove agent-switch-managed links, never user data.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export const SHARED_ITEMS = [
  "settings.json",
  "keybindings.json",
  "CLAUDE.md",
  "skills",
  "commands",
  "agents",
] as const;

/** Conversation history; opt-in — shares `claude --resume` across accounts. */
export const HISTORY_ITEMS = ["projects", "history.jsonl"] as const;

const MANIFEST = ".agent-switch-shared.json";

function readManifest(dir: string): string[] {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST), "utf8"));
    return Array.isArray(data?.links) ? data.links : [];
  } catch {
    return [];
  }
}

function writeManifest(dir: string, links: string[]): void {
  fs.writeFileSync(
    path.join(dir, MANIFEST),
    JSON.stringify({ links, tool: "agent-switch" }, null, 2) + "\n",
    { mode: 0o600 },
  );
}

/** Link items from sourceDir into targetDir. Returns human-readable actions. */
export function applySharing(
  sourceDir: string,
  targetDir: string,
  withHistory: boolean,
): string[] {
  const actions: string[] = [];
  const items = withHistory ? [...SHARED_ITEMS, ...HISTORY_ITEMS] : [...SHARED_ITEMS];
  const managed = new Set(readManifest(targetDir));
  fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });

  for (const item of items) {
    const src = path.join(sourceDir, item);
    const dst = path.join(targetDir, item);
    if (!fs.existsSync(src)) continue;

    let st: fs.Stats | null = null;
    try {
      st = fs.lstatSync(dst);
    } catch {
      /* absent */
    }
    if (st?.isSymbolicLink()) {
      if (fs.readlinkSync(dst) === src) {
        managed.add(item);
        continue; // already correct
      }
      if (!managed.has(item)) {
        actions.push(`skipped ${item}: foreign symlink present`);
        continue;
      }
      fs.unlinkSync(dst); // ours, retarget
    } else if (st) {
      actions.push(`skipped ${item}: profile has its own copy (remove it to share)`);
      continue;
    }
    fs.symlinkSync(src, dst);
    managed.add(item);
    actions.push(`linked ${item}`);
  }

  writeManifest(targetDir, [...managed]);
  return actions;
}

/** Remove agent-switch-created links only (manifest-guarded). */
export function removeSharing(targetDir: string): string[] {
  const actions: string[] = [];
  const managed = readManifest(targetDir);
  for (const item of managed) {
    const dst = path.join(targetDir, item);
    try {
      if (fs.lstatSync(dst).isSymbolicLink()) {
        fs.unlinkSync(dst);
        actions.push(`unlinked ${item}`);
      }
    } catch {
      /* already gone */
    }
  }
  writeManifest(targetDir, []);
  return actions;
}
