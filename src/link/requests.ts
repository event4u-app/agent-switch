/**
 * Switch requests: the one object agent-switch and agent-config share when a
 * session nears its limit (road-to-the-agent-config-link).
 *
 * A request asks the user to move work to another account. Either tool may
 * raise it and either may record the user's decision; the FIRST decision wins
 * and every later one reads it back instead of overwriting it, which is what
 * makes "decided in one tool" true in both. Only agent-switch executes, and
 * `claim` hands an approved request to exactly one executor.
 *
 * One file per request, written whole under one directory lock. The id is
 * derived from (account, session, window, reset), so raising twice in one
 * limit cycle returns the request that already exists.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { withFileLockSync } from "../locks.js";
import type { ProviderId } from "../providers.js";

export const REQUEST_SCHEMA = 1;
const PRUNE_AFTER_MS = 7 * 24 * 3_600_000;
/** A request whose window has no reset time stays open this long. */
const DEFAULT_TTL_MS = 5 * 3_600_000;

export type RequestState = "open" | "approved" | "declined" | "snoozed" | "executing" | "done" | "failed" | "expired";
export type MoveHow = "after-turn" | "now" | "handoff";
export type Raiser = "as-daemon" | "as-gui" | "as-cli" | "ac";

export interface Candidate {
  /** `provider/name` of the account the work would move to. */
  target: string;
  provider: ProviderId;
  fill: number | null;
  resetsAt: string | null;
  how: MoveHow[];
}

export interface SwitchRequest {
  v: typeof REQUEST_SCHEMA;
  id: string;
  rev: number;
  /** `provider/account/sessionId`, or null for "whatever runs on this account". */
  session: string | null;
  account: string;
  reason: { window: string; fill: number | null; resetsAt: string | null };
  raisedBy: Raiser;
  raisedAt: string;
  expiresAt: string;
  candidates: Candidate[];
  state: RequestState;
  decision?: { kind: "approve" | "decline" | "snooze"; target?: string; how?: MoveHow; by: string; at: string };
  /** `resume`: the command that opens the moved work when it could not open by itself. */
  outcome?: { at: string; ok: boolean; detail: string; newSession?: string; resume?: string };
}

export type RaiseInput = Pick<SwitchRequest, "account" | "session" | "reason" | "raisedBy" | "candidates">;

export type Decision =
  | { kind: "approve"; target: string; how: MoveHow; by: string }
  | { kind: "decline" | "snooze"; by: string };

const TERMINAL: ReadonlySet<RequestState> = new Set(["declined", "snoozed", "done", "failed", "expired"]);

export function requestId(account: string, session: string | null, window: string, resetsAt: string | null): string {
  return createHash("sha256").update([account, session ?? "", window, resetsAt ?? ""].join("\0")).digest("hex").slice(0, 16);
}

export class RequestStore {
  constructor(
    private readonly dir: string,
    private readonly now: () => number = Date.now,
  ) {}

  private file(id: string): string {
    return path.join(this.dir, `${id}.json`);
  }

  private locked<T>(fn: () => T): T {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    return withFileLockSync(path.join(this.dir, "requests"), fn);
  }

  private read(id: string): SwitchRequest | null {
    try {
      const r = JSON.parse(fs.readFileSync(this.file(id), "utf8"));
      return r && r.v === REQUEST_SCHEMA && typeof r.id === "string" ? (r as SwitchRequest) : null;
    } catch {
      return null;
    }
  }

  private write(r: SwitchRequest): void {
    const tmp = `${this.file(r.id)}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(r, null, 2) + "\n", { mode: 0o600 });
    fs.renameSync(tmp, this.file(r.id));
  }

  /** An open request past its expiry is expired, written back so every reader agrees. */
  private settle(r: SwitchRequest): SwitchRequest {
    if (r.state === "open" && Date.parse(r.expiresAt) <= this.now()) {
      const e: SwitchRequest = { ...r, state: "expired", rev: r.rev + 1 };
      this.write(e);
      return e;
    }
    return r;
  }

  raise(input: RaiseInput): { request: SwitchRequest; created: boolean } {
    return this.locked(() => {
      const id = requestId(input.account, input.session, input.reason.window, input.reason.resetsAt);
      const existing = this.read(id);
      if (existing) return { request: this.settle(existing), created: false };
      const now = this.now();
      const reset = input.reason.resetsAt ? Date.parse(input.reason.resetsAt) : NaN;
      const request: SwitchRequest = {
        v: REQUEST_SCHEMA,
        id,
        rev: 1,
        ...input,
        raisedAt: new Date(now).toISOString(),
        expiresAt: new Date(!isNaN(reset) && reset > now ? reset : now + DEFAULT_TTL_MS).toISOString(),
        state: "open",
      };
      this.write(request);
      return { request, created: true };
    });
  }

  get(id: string): SwitchRequest | null {
    return this.locked(() => {
      const r = this.read(id);
      return r ? this.settle(r) : null;
    });
  }

  list(): SwitchRequest[] {
    return this.locked(() => {
      if (!fs.existsSync(this.dir)) return [];
      return fs
        .readdirSync(this.dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => this.read(f.slice(0, -5)))
        .filter((r): r is SwitchRequest => r !== null)
        .map((r) => this.settle(r))
        .sort((a, b) => a.raisedAt.localeCompare(b.raisedAt) || a.id.localeCompare(b.id));
    });
  }

  /**
   * Record the user's decision. Applied only while the request is open.
   * `executed`: the deciding tool already carried the move out itself (the app
   * moving a session in its own terminal) — the request goes straight to
   * `done` in the same write, so the service can never run it a second time.
   */
  decide(id: string, d: Decision, executed?: string): { request: SwitchRequest; applied: boolean } {
    return this.locked(() => {
      const found = this.read(id);
      if (!found) throw new Error(`no switch request ${id}`);
      const r = this.settle(found);
      if (r.state !== "open") return { request: r, applied: false };
      if (d.kind === "approve" && executed === undefined) {
        const c = r.candidates.find((x) => x.target === d.target);
        if (!c) throw new Error(`${d.target} is not a candidate for request ${id}`);
        if (!c.how.includes(d.how)) throw new Error(`"${d.how}" is not offered for ${d.target} (offered: ${c.how.join(", ")})`);
      }
      const at = new Date(this.now()).toISOString();
      const decision: SwitchRequest["decision"] =
        d.kind === "approve" ? { kind: "approve", target: d.target, how: d.how, by: d.by, at } : { kind: d.kind, by: d.by, at };
      if (d.kind === "approve" && executed !== undefined) {
        const done: SwitchRequest = { ...r, state: "done", decision, outcome: { at, ok: true, detail: executed || `moved to ${d.target}` }, rev: r.rev + 1 };
        this.write(done);
        return { request: done, applied: true };
      }
      const state: RequestState = d.kind === "approve" ? "approved" : d.kind === "decline" ? "declined" : "snoozed";
      const next: SwitchRequest = { ...r, state, decision, rev: r.rev + 1 };
      this.write(next);
      return { request: next, applied: true };
    });
  }

  /** Hand an approved request to one executor; null when it is not (or no longer) approved. */
  claim(id: string): SwitchRequest | null {
    return this.locked(() => {
      const r = this.read(id);
      if (!r || r.state !== "approved") return null;
      const next: SwitchRequest = { ...r, state: "executing", rev: r.rev + 1 };
      this.write(next);
      return next;
    });
  }

  finish(id: string, o: { ok: boolean; detail: string; newSession?: string; resume?: string }): SwitchRequest | null {
    return this.locked(() => {
      const r = this.read(id);
      if (!r || r.state !== "executing") return null;
      const outcome = {
        at: new Date(this.now()).toISOString(),
        ok: o.ok,
        detail: o.detail,
        ...(o.newSession ? { newSession: o.newSession } : {}),
        ...(o.resume ? { resume: o.resume } : {}),
      };
      const next: SwitchRequest = { ...r, state: o.ok ? "done" : "failed", outcome, rev: r.rev + 1 };
      this.write(next);
      return next;
    });
  }

  /** Delete finished requests older than seven days; returns how many. */
  prune(): number {
    const cutoff = this.now() - PRUNE_AFTER_MS;
    let n = 0;
    for (const r of this.list()) {
      const last = Date.parse(r.outcome?.at ?? r.decision?.at ?? r.expiresAt);
      if (TERMINAL.has(r.state) && last < cutoff) {
        this.locked(() => fs.rmSync(this.file(r.id), { force: true }));
        n++;
      }
    }
    return n;
  }
}
