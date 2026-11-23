/**
 * Program Status Protocol (OSC 7501) as a hosted window reports it, read-only.
 * Codex 0.167.0 sends `ESC ] 7501 ; state=working:app=codex` (BEL or ST)
 * unasked, so the host
 * reads its window's output through `tmux pipe-pane -O` and never answers a
 * probe: answering would type into the pane outside the input lease.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const INTRO = "\x1b]7501;";
/** The protocol caps a whole sequence at 4096 bytes; a longer body is not a report. */
export const MAX_BODY = 4087;

export type ProgramState = "idle" | "working" | "done" | "blocked" | "error";
const STATES: ReadonlySet<string> = new Set(["idle", "working", "done", "blocked", "error"]);

export interface ProgramReport {
  state: ProgramState;
  app?: string;
}

/** `key=value` pairs joined by `:`. Only a root record (no `id`) with a known state is a report; anything else is null. Pure. */
export function parseReport(body: string): ProgramReport | null {
  const fields = new Map<string, string>();
  for (const part of body.split(":")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const k = part.slice(0, eq);
    if (!/^[a-z]{1,16}$/.test(k)) continue;
    fields.set(k, part.slice(eq + 1));
  }
  const state = fields.get("state");
  if (!state || !STATES.has(state) || fields.has("id")) return null;
  const app = fields.get("app");
  return { state: state as ProgramState, ...(app && /^[A-Za-z0-9_.+-]{1,32}$/.test(app) ? { app } : {}) };
}

/**
 * Finds OSC 7501 reports in a byte stream fed in arbitrary chunks. Holds at most
 * one unterminated sequence (bounded by {@link MAX_BODY}) between chunks; an
 * escape that is not ST, or an over-long body, drops the sequence.
 */
export class OscScanner {
  private pending = "";

  push(chunk: Buffer | string): ProgramReport[] {
    // latin1 maps every byte to one code unit, so a split UTF-8 sequence elsewhere cannot shift offsets.
    const s = this.pending + (typeof chunk === "string" ? chunk : chunk.toString("latin1"));
    this.pending = "";
    const out: ProgramReport[] = [];
    let i = 0;
    while (i < s.length) {
      const start = s.indexOf(INTRO, i);
      if (start < 0) {
        this.pending = partialIntro(s, i);
        break;
      }
      const body = start + INTRO.length;
      let j = body;
      let done = false;
      let incomplete = true;
      while (j < s.length) {
        const c = s.charCodeAt(j);
        if (c === 0x07) {
          done = true;
          break;
        }
        if (c === 0x1b) {
          if (j + 1 >= s.length) break;
          incomplete = false;
          if (s[j + 1] === "\\") done = true;
          break;
        }
        if (j - body >= MAX_BODY) {
          incomplete = false;
          break;
        }
        j++;
      }
      if (done) {
        const r = parseReport(s.slice(body, j));
        if (r) out.push(r);
        i = j + (s.charCodeAt(j) === 0x07 ? 1 : 2);
        continue;
      }
      if (incomplete) {
        // Unterminated so far: keep it for the next chunk.
        this.pending = s.slice(start);
        break;
      }
      // Aborted (another escape, or too long): resume after the introducer.
      i = j > body && s.charCodeAt(j) === 0x1b ? j : body;
    }
    return out;
  }
}

/** A trailing prefix of the introducer, so `ESC ] 75` + `01;…` across chunks still matches. */
function partialIntro(s: string, from: number): string {
  for (let k = Math.min(INTRO.length - 1, s.length - from); k > 0; k--) {
    if (INTRO.startsWith(s.slice(s.length - k))) return s.slice(s.length - k);
  }
  return "";
}

export interface ProgramStatusRecord {
  state: ProgramState;
  app?: string;
  /** Epoch ms the report arrived. */
  at: number;
}

/** Where a hosted session's reader writes: keyed by the session id, which a respawn keeps. */
export function programStatusFile(root: string, sessionId: string): string {
  return path.join(root, "host", "program", `${sessionId.replace(/[^A-Za-z0-9_-]/g, "_")}.json`);
}

export function readProgramStatus(file: string): ProgramStatusRecord | null {
  try {
    const o = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!o || typeof o.state !== "string" || !STATES.has(o.state) || typeof o.at !== "number") return null;
    return { state: o.state, at: o.at, ...(typeof o.app === "string" ? { app: o.app } : {}) };
  } catch {
    return null;
  }
}

function writeAtomic(file: string, rec: ProgramStatusRecord): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rec) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/**
 * `__program-status <file>`: read a pane's output on stdin until it closes (the
 * window ends), and write the latest report whenever the state changes. Never
 * throws on input; a failed write is skipped and the next change tries again.
 */
export function runProgramStatus(file: string, input: NodeJS.ReadableStream = process.stdin, now: () => number = Date.now, app = "codex"): Promise<void> {
  const scanner = new OscScanner();
  let last = readProgramStatus(file)?.state ?? null;
  return new Promise((resolve) => {
    input.on("data", (chunk: Buffer | string) => {
      for (const r of scanner.push(chunk)) {
        // Anything the pane prints can carry this sequence; requiring the app's own name only stops the easy spoof.
        if (r.app !== app || r.state === last) continue;
        try {
          writeAtomic(file, { state: r.state, ...(r.app ? { app: r.app } : {}), at: now() });
          last = r.state;
        } catch {
          // A full disk or a removed folder must not end the reader.
        }
      }
    });
    input.on("end", () => resolve());
    input.on("error", () => resolve());
  });
}

/**
 * Which listed Codex rollout belongs to a hosted window. Codex picks its own
 * thread id, so the host's id rarely matches; the fallback is the same account
 * and folder: the first rollout born at or after the window started, or — only
 * when none is — the latest one born up to 5 s before (clock and file-system
 * lag). Each row is claimed once. Pure.
 */
export function matchHostedRows<R extends { sessionId: string; profile: string; cwd: string | null; birthtimeMs: number }, H extends { sessionId: string; account: string; cwd: string; startedAt: string }>(
  rows: readonly R[],
  hosted: readonly H[],
): Map<R, H> {
  const out = new Map<R, H>();
  const byStart = [...hosted].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  for (const h of byStart) {
    const exact = rows.find((r) => r.profile === h.account && r.sessionId === h.sessionId && !out.has(r));
    if (exact) {
      out.set(exact, h);
      continue;
    }
    const start = Date.parse(h.startedAt);
    const free = rows.filter((r) => !out.has(r) && r.profile === h.account && r.cwd === h.cwd);
    const after = free.filter((r) => r.birthtimeMs >= start).sort((a, b) => a.birthtimeMs - b.birthtimeMs)[0];
    const near = free.filter((r) => r.birthtimeMs < start && r.birthtimeMs >= start - 5_000).sort((a, b) => b.birthtimeMs - a.birthtimeMs)[0];
    const cand = after ?? near;
    if (cand) out.set(cand, h);
  }
  return out;
}
