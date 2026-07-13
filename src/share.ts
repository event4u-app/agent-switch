/**
 * Share user-level settings across profiles via links.
 *
 * Two link kinds, because Claude Code's settings writer writes atomically
 * (write-temp + rename), which breaks a symlinked FILE but not a symlinked
 * DIRECTORY (issue #40857, verified in tests/integration.test.ts):
 *
 *   - Directories (`skills/`, `commands/`, `agents/`) — genuinely shared. A
 *     write inside the linked dir lands in the source. Linked as a symlink on
 *     POSIX, a junction on win32 (junctions need no elevation).
 *   - Files (`settings.json`, `keybindings.json`, `CLAUDE.md`) — linked, but
 *     an in-profile `/config` write forks the file (the rename replaces the
 *     link with a regular file). `agent-switch share sync` detects a forked link
 *     from the manifest, pushes the profile's edit back into the source, and
 *     re-links (last-sync-wins across profiles). On win32, file symlinks need
 *     Developer Mode/admin, so file links degrade with a message there.
 *
 * Account-/instance-scoped items (`.claude.json`, `.credentials.json`,
 * `plugins/`, `sessions/`, `ide/`, `statsig/`) are deliberately never shared.
 * History (`projects/`, `history.jsonl`) is a POSIX-only opt-in.
 *
 * A manifest (.agent-switch-shared.json) records what agent-switch created, so
 * unshare/sync only ever touch agent-switch-managed links, never user data.
 */

import * as fs from "node:fs";
import * as path from "node:path";

interface ShareItem {
  name: string;
  kind: "file" | "dir";
}

const BASE_ITEMS: ShareItem[] = [
  { name: "settings.json", kind: "file" },
  { name: "keybindings.json", kind: "file" },
  { name: "CLAUDE.md", kind: "file" },
  { name: "skills", kind: "dir" },
  { name: "commands", kind: "dir" },
  { name: "agents", kind: "dir" },
];

/** Conversation history; opt-in — shares `claude --resume` across accounts. */
const HISTORY_ITEMS: ShareItem[] = [
  { name: "projects", kind: "dir" },
  { name: "history.jsonl", kind: "file" },
];

/** Names exported for messaging/tests. */
export const SHARED_ITEMS = BASE_ITEMS.map((i) => i.name);
export const HISTORY_ITEM_NAMES = HISTORY_ITEMS.map((i) => i.name);

const ITEM_KIND = new Map<string, "file" | "dir">(
  [...BASE_ITEMS, ...HISTORY_ITEMS].map((i) => [i.name, i.kind]),
);

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

/**
 * Create a link of the right kind for the platform. Directories use a junction
 * on win32 (no elevation); files use a native symlink everywhere. Throws on
 * failure so the caller can degrade (win32 file symlink without Dev Mode).
 */
function link(src: string, dst: string, kind: "file" | "dir"): void {
  if (kind === "dir") {
    fs.symlinkSync(src, dst, process.platform === "win32" ? "junction" : "dir");
  } else {
    fs.symlinkSync(src, dst, process.platform === "win32" ? "file" : undefined);
  }
}

/** True when the existing symlink already points at src (junction paths on
 *  win32 may carry a trailing separator / `\\?\` prefix, so compare loosely). */
function pointsAt(dst: string, src: string): boolean {
  try {
    const target = fs.readlinkSync(dst).replace(/[\\/]+$/, "");
    return path.resolve(target) === path.resolve(src);
  } catch {
    return false;
  }
}

/** Link items from sourceDir into targetDir. Returns human-readable actions. */
export function applySharing(sourceDir: string, targetDir: string, withHistory: boolean): string[] {
  const actions: string[] = [];
  const items = withHistory ? [...BASE_ITEMS, ...HISTORY_ITEMS] : [...BASE_ITEMS];
  const managed = new Set(readManifest(targetDir));
  fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });

  for (const item of items) {
    const src = path.join(sourceDir, item.name);
    const dst = path.join(targetDir, item.name);
    if (!fs.existsSync(src)) continue;

    let st: fs.Stats | null = null;
    try {
      st = fs.lstatSync(dst);
    } catch {
      /* absent */
    }

    if (st?.isSymbolicLink()) {
      if (pointsAt(dst, src)) {
        managed.add(item.name);
        continue; // already correct
      }
      if (!managed.has(item.name)) {
        actions.push(`skipped ${item.name}: foreign symlink present`);
        continue;
      }
      fs.unlinkSync(dst); // ours, retarget
    } else if (st) {
      // A regular file/dir sits where a link would go.
      if (item.kind === "file" && managed.has(item.name)) {
        // We linked it before; it's now a regular file → an in-profile write
        // forked it. Don't clobber — `share sync` reconciles it.
        actions.push(`forked ${item.name}: run 'agent-switch share sync' to re-link`);
        continue;
      }
      actions.push(`skipped ${item.name}: profile has its own copy (remove it to share)`);
      continue;
    }

    try {
      link(src, dst, item.kind);
      managed.add(item.name);
      actions.push(`linked ${item.name}`);
    } catch (err: any) {
      if (process.platform === "win32" && item.kind === "file") {
        actions.push(
          `skipped ${item.name}: Windows file symlinks need Developer Mode or admin ` +
            `(directories are shared via junction regardless)`,
        );
      } else {
        throw err;
      }
    }
  }

  writeManifest(targetDir, [...managed]);
  return actions;
}

/**
 * Reconcile forked file links: a managed file that is now a regular file was
 * forked by an in-profile `/config` write. Push its content back into the
 * shared source (so the edit propagates, last-sync-wins), then re-link. Also
 * re-creates a managed link that vanished. Directory links do not fork, so an
 * unexpected directory in place of a link is reported, never clobbered.
 */
export function syncSharing(sourceDir: string, targetDir: string): string[] {
  const actions: string[] = [];
  for (const name of readManifest(targetDir)) {
    const src = path.join(sourceDir, name);
    const dst = path.join(targetDir, name);
    const kind = ITEM_KIND.get(name) ?? "file";

    let st: fs.Stats | null = null;
    try {
      st = fs.lstatSync(dst);
    } catch {
      /* missing */
    }

    if (!st) {
      if (fs.existsSync(src)) {
        link(src, dst, kind);
        actions.push(`relinked ${name} (was missing)`);
      }
      continue;
    }
    if (st.isSymbolicLink()) continue; // intact

    if (st.isFile()) {
      // Forked file: propagate the profile's edit to the source, then re-link.
      fs.mkdirSync(path.dirname(src), { recursive: true });
      fs.copyFileSync(dst, src);
      fs.unlinkSync(dst);
      link(src, dst, "file");
      actions.push(`synced ${name} (profile edit pushed to source, re-linked)`);
    } else {
      actions.push(`skipped ${name}: unexpected directory where a link was — left untouched`);
    }
  }
  return actions;
}

export type LinkState = "linked" | "forked" | "missing";

/** Health of each manifest-managed link in a profile, for `doctor`.
 *  `linked` = intact symlink/junction; `forked` = a /config write replaced it
 *  with a regular file (run `share sync`); `missing` = the link is gone. */
export function sharedLinkHealth(targetDir: string): { name: string; state: LinkState }[] {
  return readManifest(targetDir).map((name) => {
    const dst = path.join(targetDir, name);
    try {
      return { name, state: fs.lstatSync(dst).isSymbolicLink() ? "linked" : "forked" };
    } catch {
      return { name, state: "missing" };
    }
  });
}

/** Remove agent-switch-created links only (manifest-guarded). */
export function removeSharing(targetDir: string): string[] {
  const actions: string[] = [];
  for (const name of readManifest(targetDir)) {
    const dst = path.join(targetDir, name);
    try {
      const st = fs.lstatSync(dst);
      // A symlink (POSIX) or a junction (win32, reported as a symlink by
      // lstat) is ours to remove; a forked regular file is the user's, leave it.
      if (st.isSymbolicLink()) {
        fs.unlinkSync(dst);
        actions.push(`unlinked ${name}`);
      }
    } catch {
      /* already gone */
    }
  }
  writeManifest(targetDir, []);
  return actions;
}
