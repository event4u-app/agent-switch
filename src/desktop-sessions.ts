/**
 * Claude Code sessions run from Claude Desktop.
 *
 * Desktop keeps one metadata file per session under its data dir, filed by
 * the signed-in account: `<data>/<kind>/<accountUuid>/<orgUuid>/local_<id>.json`
 * with the `cliSessionId` that names the transcript. Where that transcript
 * lives depends on the kind (measured on Claude Desktop with Claude Code
 * 2.1.295):
 *
 *   - `claude-code-sessions` (the Code tab): in the DEFAULT `~/.claude/projects/`
 *     — even when the Desktop instance belongs to an agent-switch profile.
 *   - `local-agent-mode-sessions`: in the session's own `local_<id>/.claude/`.
 *
 * The transcript itself names no account, so a session is attributed through
 * the account folder it is filed under, matched against each profile's
 * `oauthAccount.accountUuid`. A profile's Desktop instance holding sessions of
 * another account is signed in with that account — the caller warns about it.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { readSessionHeader, type SessionRow } from "./sessions.js";

/** Written within this long → shown as running (Desktop leaves no pid to check). */
export const DESKTOP_LIVE_MS = 2 * 60_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = ["claude-code-sessions", "local-agent-mode-sessions"] as const;

export interface DesktopInstance {
  /** The profile whose own Desktop instance this is; null = the regular app. */
  profile: string | null;
  dir: string;
}

export interface DesktopRow extends SessionRow {
  profile: string;
  surface: "desktop-app";
}

export interface DesktopInstanceReport extends DesktopInstance {
  /** Accounts that ran sessions in this instance, by uuid. */
  accounts: { accountUuid: string; profile: string | null }[];
  /** A profile's instance that holds another account's sessions. */
  mismatch: boolean;
}

export interface DesktopScan {
  rows: DesktopRow[];
  instances: DesktopInstanceReport[];
}

function dirs(p: string): string[] {
  try {
    return fs
      .readdirSync(p, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

function files(p: string): string[] {
  try {
    return fs.readdirSync(p).filter((f) => f.startsWith("local_") && f.endsWith(".json"));
  } catch {
    return [];
  }
}

/** `<projects>/<any encoded cwd>/<id>.jsonl`, or null. */
function findTranscript(projects: string, id: string): string | null {
  for (const d of dirs(projects)) {
    const f = path.join(projects, d, `${id}.jsonl`);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

function readMeta(file: string): Record<string, unknown> | null {
  try {
    const d = JSON.parse(fs.readFileSync(file, "utf8"));
    return d && typeof d === "object" ? d : null;
  } catch {
    return null;
  }
}

export function scanDesktop(opts: {
  instances: DesktopInstance[];
  /** The default Claude Code config dir (`~/.claude`). */
  claudeHome: string;
  /** The agent-switch profile signed in as this account uuid, or null. */
  profileOf: (accountUuid: string) => string | null;
  now: number;
}): DesktopScan {
  const rows: DesktopRow[] = [];
  const instances: DesktopInstanceReport[] = [];
  for (const inst of opts.instances) {
    const seen = new Map<string, string | null>();
    for (const kind of KINDS) {
      const base = path.join(inst.dir, kind);
      for (const account of dirs(base).filter((d) => UUID_RE.test(d))) {
        const profile = opts.profileOf(account);
        seen.set(account, profile);
        for (const org of dirs(path.join(base, account))) {
          const folder = path.join(base, account, org);
          for (const f of files(folder)) {
            const m = readMeta(path.join(folder, f));
            const id = typeof m?.cliSessionId === "string" && UUID_RE.test(m.cliSessionId) ? m.cliSessionId : null;
            if (!m || !id || m.isArchived === true || !profile) continue;
            const transcript =
              kind === "claude-code-sessions"
                ? findTranscript(path.join(opts.claudeHome, "projects"), id)
                : findTranscript(path.join(folder, f.slice(0, -".json".length), ".claude", "projects"), id);
            let st: fs.Stats | null = null;
            try {
              st = transcript ? fs.statSync(transcript) : null;
            } catch {
              st = null;
            }
            const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
            const mtimeMs = st?.mtimeMs ?? num(m.lastActivityAt) ?? num(m.createdAt) ?? 0;
            const header = transcript ? readSessionHeader(transcript) : { cwd: null, summary: null };
            rows.push({
              sessionId: id,
              projectDir: transcript ? path.basename(path.dirname(transcript)) : "",
              cwd: typeof m.cwd === "string" ? m.cwd : header.cwd,
              summary: typeof m.title === "string" && m.title ? m.title : header.summary,
              mtimeMs,
              birthtimeMs: num(m.createdAt) ?? st?.birthtimeMs ?? mtimeMs,
              live: !!st && opts.now - st.mtimeMs <= DESKTOP_LIVE_MS,
              ...(transcript ? { file: transcript } : {}),
              profile,
              surface: "desktop-app",
            });
          }
        }
      }
    }
    const accounts = [...seen.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([accountUuid, profile]) => ({ accountUuid, profile }));
    instances.push({ ...inst, accounts, mismatch: inst.profile !== null && accounts.some((a) => a.profile !== inst.profile) });
  }
  rows.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return { rows, instances };
}
