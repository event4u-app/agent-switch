/**
 * Which permission mode a chat runs in. The chat is the same Claude Code session as the
 * terminal, so it takes the mode the session last ran in (each transcript line records it),
 * else the account's `permissions.defaultMode`, else asks before edits. A mode that skips
 * approvals (`bypassPermissions`, `dontAsk`) is never taken over: approvals stay with the person.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { PERMISSION_MODES, type PermissionMode } from "./claude-bridge.js";

/** A mode as the chat may run it (`default` is Claude's `manual`), or null for one it never takes over. Pure. */
export function chatMode(raw: unknown): PermissionMode | null {
  if (raw === "manual") return "default";
  return (PERMISSION_MODES as readonly unknown[]).includes(raw) ? (raw as PermissionMode) : null;
}

/** How much of a transcript's end is read for its mode: the newest line carries it. */
const TAIL_BYTES = 512 * 1024;

/** The permission mode the session's newest transcript line records, or null. */
export function lastPermissionMode(transcript: string | null): string | null {
  if (!transcript) return null;
  let fd: number | null = null;
  try {
    fd = fs.openSync(transcript, "r");
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    const all = [...buf.toString("utf8").matchAll(/"permissionMode":\s*"([A-Za-z]+)"/g)];
    return all.at(-1)?.[1] ?? null;
  } catch {
    return null;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

/** The account's `permissions.defaultMode` from its settings.json, or null. */
export function settingsDefaultMode(configDir: string): string | null {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(configDir, "settings.json"), "utf8")) as { permissions?: { defaultMode?: unknown } };
    return typeof s.permissions?.defaultMode === "string" ? s.permissions.defaultMode : null;
  } catch {
    return null;
  }
}

/** The mode a chat on this session takes over. */
export function inheritedMode(transcript: string | null, configDir: string): PermissionMode {
  return chatMode(lastPermissionMode(transcript)) ?? chatMode(settingsDefaultMode(configDir)) ?? "default";
}

/** `<configDir>/projects/<any>/<id>.jsonl`, or null. */
export function findTranscript(configDir: string, sessionId: string): string | null {
  const projects = path.join(configDir, "projects");
  try {
    for (const p of fs.readdirSync(projects)) {
      const f = path.join(projects, p, `${sessionId}.jsonl`);
      if (fs.existsSync(f)) return f;
    }
  } catch {
    // no projects folder
  }
  return null;
}
