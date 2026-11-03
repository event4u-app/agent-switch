/** Shapes of the v3 CLI reads (`--json`), as the adapter consumes them. Every
 *  parser here takes unknown input and returns a safe value: an unknown field
 *  is ignored, a missing one becomes empty. */

import type { DoneItem } from "../overlays.js";

export interface EngineHealth {
  running: boolean;
  reason: string | null;
  hostedRunning: number;
}

export interface HostedRow {
  key: string;
  provider: string;
  account: string;
  sessionId: string;
  cwd: string;
  startedAt: string;
  alive: boolean;
}

export interface HostList {
  mode: "persistent" | "ephemeral";
  hosted: HostedRow[];
}

export interface PrFacts {
  number: number;
  url: string;
  lifecycle: string;
  mergeable: string;
  review: string;
  ci: string;
  failingChecks: string[];
}

export interface PrStatus {
  problem: { message: string; fix: string } | null;
  /** By session key. */
  byKey: Record<string, PrFacts[]>;
}

export interface OpenTargetsGlobal {
  default: string | null;
  perRepo: Record<string, string>;
  targets: { target: string; label: string; kind: "editor" | "files" | "terminal"; installed: boolean }[];
}

export type KeptState = { state: "kept"; bytes: number } | { state: "at-risk"; daysLeft: number } | { state: "lost" };

export interface LibraryEntryRow {
  key: string;
  name: string | null;
  tags: string[];
  pinned: boolean;
  archived: boolean;
  autoKept: boolean;
  summary: string | null;
  cwd: string | null;
  branch: string | null;
  pr: { number: number; lifecycle: string } | null;
  lastMs: number;
  kept: KeptState;
  canResume: boolean;
}

export interface LibraryList {
  autoKeep: boolean;
  vaultBytes: number;
  entries: LibraryEntryRow[];
}

export interface HistoryRow extends DoneItem {
  kind: string;
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);

export function parseEngine(v: unknown): EngineHealth {
  const o = obj(v);
  return { running: o.running === true, reason: str(o.reason), hostedRunning: num(o.hostedRunning) };
}

export function parseHostList(v: unknown): HostList {
  const o = obj(v);
  const hosted = arr(o.hosted)
    .map(obj)
    .filter((h) => typeof h.key === "string")
    .map((h) => ({
      key: h.key as string,
      provider: str(h.provider) ?? "",
      account: str(h.account) ?? "",
      sessionId: str(h.sessionId) ?? "",
      cwd: str(h.cwd) ?? "",
      startedAt: str(h.startedAt) ?? "",
      alive: h.alive === true,
    }));
  return { mode: o.mode === "persistent" ? "persistent" : "ephemeral", hosted };
}

export function parsePr(v: unknown): PrFacts | null {
  const p = obj(v);
  if (typeof p.number !== "number") return null;
  return {
    number: p.number,
    url: str(p.url) ?? "",
    lifecycle: str(p.lifecycle) ?? "UNKNOWN",
    mergeable: str(p.mergeable) ?? "UNKNOWN",
    review: str(p.review) ?? "NONE",
    ci: str(p.ci) ?? "UNKNOWN",
    failingChecks: arr(p.failingChecks).filter((c): c is string => typeof c === "string"),
  };
}

export function parsePrStatus(v: unknown): PrStatus {
  const o = obj(v);
  const pb = obj(o.problem);
  const byKey: Record<string, PrFacts[]> = {};
  for (const s of arr(o.sessions).map(obj)) {
    if (typeof s.key !== "string") continue;
    byKey[s.key] = arr(s.prs).map(parsePr).filter((p): p is PrFacts => p !== null);
  }
  return { problem: typeof pb.message === "string" ? { message: pb.message, fix: str(pb.fix) ?? "" } : null, byKey };
}

export function parseOpenTargets(v: unknown): OpenTargetsGlobal {
  const o = obj(v);
  const kinds = new Set(["editor", "files", "terminal"]);
  const perRepo: Record<string, string> = {};
  for (const [k, t] of Object.entries(obj(o.perRepo))) if (typeof t === "string") perRepo[k] = t;
  return {
    default: str(o.default),
    perRepo,
    targets: arr(o.targets)
      .map(obj)
      .filter((t) => typeof t.target === "string" && kinds.has(t.kind as string))
      .map((t) => ({ target: t.target as string, label: str(t.label) ?? (t.target as string), kind: t.kind as "editor" | "files" | "terminal", installed: t.installed === true })),
  };
}

function parseKept(v: unknown): KeptState {
  const k = obj(v);
  if (k.state === "kept") return { state: "kept", bytes: num(k.bytes) };
  if (k.state === "at-risk") return { state: "at-risk", daysLeft: num(k.daysLeft) };
  return { state: "lost" };
}

export function parseLibrary(v: unknown): LibraryList {
  const o = obj(v);
  return {
    autoKeep: o.autoKeep !== false,
    vaultBytes: num(o.vaultBytes),
    entries: arr(o.entries)
      .map(obj)
      .filter((e) => typeof e.key === "string")
      .map((e) => {
        const pr = obj(e.pr);
        return {
          key: e.key as string,
          name: str(e.name),
          tags: arr(e.tags).filter((t): t is string => typeof t === "string"),
          pinned: e.pinned === true,
          archived: e.archived === true,
          autoKept: e.autoKept === true,
          summary: str(e.summary),
          cwd: str(e.cwd),
          branch: str(e.branch),
          pr: typeof pr.number === "number" ? { number: pr.number, lifecycle: str(pr.lifecycle) ?? "UNKNOWN" } : null,
          lastMs: num(e.lastMs),
          kept: parseKept(e.kept),
          canResume: e.canResume === true,
        };
      }),
  };
}

export function parseChanges(v: unknown): { status: "A" | "M" | "D" | "R" | "?"; path: string; added: number; removed: number }[] {
  const st = new Set(["A", "M", "D", "R", "?"]);
  return arr(obj(v).files)
    .map(obj)
    .filter((f) => typeof f.path === "string" && st.has(f.status as string))
    .map((f) => ({ status: f.status as "A" | "M" | "D" | "R" | "?", path: f.path as string, added: num(f.added), removed: num(f.removed) }));
}

export function parseHistory(v: unknown): HistoryRow[] {
  return arr(v)
    .map(obj)
    .filter((h) => typeof h.id === "string" && typeof h.doneAt === "string")
    .map((h) => ({ id: h.id as string, kind: str(h.kind) ?? "", who: str(h.who) ?? "", what: str(h.what) ?? "", doneAt: h.doneAt as string }));
}
