/**
 * Copy one desktop profile's local settings into another (Claude Desktop):
 * MCP servers, preferences and installed extensions. Chats, Projects and
 * memory live with the account on the server, so they are not here at all.
 *
 * What is never copied: `config.json` (it holds the OAuth token cache),
 * cookies and web storage (the login), session folders (bound to an account
 * id), and preference keys scoped to one account (`…ByAccount`) or to the
 * target's own files (`coworkUserFilesPath`).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

type Json = Record<string, unknown>;

interface SettingsLayout {
  /** JSON files merged key-wise (target keeps what the source lacks). */
  merged: string[];
  /** Directories replaced as a whole. */
  replaced: string[];
}

const LAYOUTS: Record<string, SettingsLayout> = {
  "claude-desktop": {
    merged: ["claude_desktop_config.json", "claude_desktop_config.mcp.json"],
    replaced: ["Claude Extensions", "Claude Extensions Settings"],
  },
};

/** The app's own data dir outside agent-switch (the plain, unprofiled install). */
export const DEFAULT_DATA_DIR: Record<string, string> = {
  "claude-desktop": path.posix.join(os.homedir(), "Library", "Application Support", "Claude"),
};

export function hasSettingsLayout(appId: string): boolean {
  return appId in LAYOUTS;
}

function isObject(v: unknown): v is Json {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export function mergeDesktopConfig(src: Json, dst: Json): Json {
  const out: Json = { ...dst };
  if (src.mcpServers !== undefined) out.mcpServers = src.mcpServers;
  if (isObject(src.preferences)) {
    const prefs: Json = isObject(dst.preferences) ? { ...dst.preferences } : {};
    for (const [k, v] of Object.entries(src.preferences)) if (!k.endsWith("ByAccount")) prefs[k] = v;
    out.preferences = prefs;
  }
  return out;
}

function readJson(file: string): Json | null {
  try {
    const v = JSON.parse(fs.readFileSync(file, "utf8"));
    return isObject(v) ? v : null;
  } catch {
    return null;
  }
}

function backup(file: string): string {
  let to = `${file}.pre-copy`;
  if (fs.existsSync(to)) to = `${file}.pre-copy-${Date.now()}`;
  fs.cpSync(file, to, { recursive: true });
  return to;
}

export function copyDesktopSettings(appId: string, fromDir: string, toDir: string): { copied: string[]; backups: string[] } {
  const layout = LAYOUTS[appId];
  if (!layout) throw new Error(`${appId} has no settings layout agent-switch knows how to copy.`);
  fs.mkdirSync(toDir, { recursive: true });
  const copied: string[] = [];
  const backups: string[] = [];
  for (const name of layout.merged) {
    const src = readJson(path.join(fromDir, name));
    if (!src) continue;
    const dstFile = path.join(toDir, name);
    const dst = fs.existsSync(dstFile) ? readJson(dstFile) : null;
    if (fs.existsSync(dstFile)) backups.push(backup(dstFile));
    fs.writeFileSync(dstFile, JSON.stringify(mergeDesktopConfig(src, dst ?? {}), null, 2) + "\n");
    copied.push(name);
  }
  for (const name of layout.replaced) {
    const src = path.join(fromDir, name);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(toDir, name);
    if (fs.existsSync(dst)) {
      backups.push(backup(dst));
      fs.rmSync(dst, { recursive: true, force: true });
    }
    fs.cpSync(src, dst, { recursive: true });
    copied.push(name);
  }
  return { copied, backups };
}
