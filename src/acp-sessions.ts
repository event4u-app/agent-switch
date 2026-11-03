/**
 * Sessions AS started with an ACP agent (v3.2 M15). ACP has no session listing
 * (Gemini answers `session/list` with "method not found", Phase 0), so AS keeps
 * its own index: key `acp/<agent>/<session>` → the folder it runs in. Resuming
 * goes through `session/load`, which needs that folder.
 *
 * File: `<ROOT>/acp-sessions.json`, newest last, capped.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { ROOT, ensureRoot } from "./profiles.js";

export const ACP_SESSIONS_FILE = path.join(ROOT, "acp-sessions.json");
const MAX = 500;
const SESSION_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const AGENT_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;

export interface AcpSession {
  key: string;
  agent: string;
  sessionId: string;
  cwd: string;
  startedAt: string;
}

/** `acp/<agent>/<session>` → its parts, or null when either part is not a valid id. Pure. */
export function parseAcpKey(key: string): { agent: string; sessionId: string } | null {
  const m = /^acp\/([^/]+)\/([^/]+)$/.exec(key);
  if (!m || !AGENT_ID.test(m[1]) || !SESSION_ID.test(m[2])) return null;
  return { agent: m[1], sessionId: m[2] };
}

export function readAcpSessions(file: string = ACP_SESSIONS_FILE): AcpSession[] {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return (Array.isArray(raw) ? raw : []).filter(
      (s: AcpSession) => s && typeof s.cwd === "string" && path.isAbsolute(s.cwd) && typeof s.startedAt === "string" && parseAcpKey(s.key)?.sessionId === s.sessionId,
    );
  } catch {
    return [];
  }
}

export function recordAcpSession(agent: string, sessionId: string, cwd: string, file: string = ACP_SESSIONS_FILE, now: Date = new Date()): AcpSession {
  const key = `acp/${agent}/${sessionId}`;
  if (!parseAcpKey(key)) throw new Error(`not a valid ACP session: ${key}`);
  const row: AcpSession = { key, agent, sessionId, cwd, startedAt: now.toISOString() };
  const rows = [...readAcpSessions(file).filter((s) => s.key !== key), row].slice(-MAX);
  if (file === ACP_SESSIONS_FILE) ensureRoot();
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, file);
  return row;
}

export function findAcpSession(key: string, file: string = ACP_SESSIONS_FILE): AcpSession | null {
  return readAcpSessions(file).find((s) => s.key === key) ?? null;
}
