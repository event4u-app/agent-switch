/**
 * Pure builders: CLI `--json` rows (via ipc.ts types) → view-model entities.
 * No Tauri imports, so every mapping is unit-testable. Where the CLI reports
 * nothing (plan, auth health, pools, bindings, protection, surfaces) the field
 * stays null/empty — the screens render the design's honest unknown state.
 */

import type { AcStatus, AppInfo, ToolingEntry } from "../ipc.js";
import type { AppNotification } from "../notifications.js";
import type { ProfileRow, ProvidersStatus, SessionRow, UsageSnapshot } from "../transforms.js";
import { countdown } from "../ui/format.js";
import { bindingWindow, isStale, maxUtilization, toneFor, toolStatus } from "./rules.js";
import type {
  Account,
  AccountState,
  AgentConfigVm,
  Attention,
  IdentityColor,
  Notice,
  Provider,
  Readiness,
  Session,
  Surface,
  ToolEntry,
} from "./types.js";
import { IDENTITY_COLORS } from "./types.js";

/** Default near-limit threshold when the CLI reports none (the design's 98 %). */
export const DEFAULT_THRESHOLD = 98;
/** A live session written to within this window counts as working. */
export const WORKING_FRESH_MS = 60_000;

export function accountId(provider: string, name: string): string {
  return `${provider}:${name}`;
}

/** No backend stores an account colour yet: derive a stable one from the id so
 *  the same account keeps its colour across launches. */
export function colorFor(id: string): IdentityColor {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return IDENTITY_COLORS[h % IDENTITY_COLORS.length];
}

function parseTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/** limited at 100 %, near-limit inside the warn band, else ready. Sign-in
 *  states are never inferred — no CLI reports auth health yet. */
export function accountState(usage: UsageSnapshot | null | undefined, threshold: number): AccountState {
  const max = usage ? maxUtilization(usage.windows) : null;
  if (max != null && max >= 100) return "limited";
  const tone = toneFor(max, threshold);
  return tone === "warn" || tone === "alert" ? "near-limit" : "ready";
}

export function accountFromProfile(
  row: ProfileRow,
  usage: UsageSnapshot | null | undefined,
  threshold: number = DEFAULT_THRESHOLD,
): Account {
  const id = accountId(row.provider, row.name);
  return {
    id,
    tool: row.provider,
    name: row.name,
    identity: row.identity,
    plan: null,
    label: row.label,
    color: colorFor(id),
    isDefault: row.active,
    state: accountState(usage, threshold),
    windows: usage ? usage.windows.map((w) => ({ ...w })) : [],
    checkedAt: parseTime(usage?.capturedAt),
    resetCredits: usage?.resetCredits ?? null,
    threshold,
    protection: null,
    auth: null,
    surfaces: [],
    liveSessions: row.liveSessions,
    pools: [],
  };
}

function basename(path: string): string {
  const parts = path.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || path;
}

export function sessionFromRow(row: SessionRow, now: number): Session {
  const cwd = row.cwd ?? row.projectDir;
  const fresh = now - row.mtimeMs;
  const state = !row.live ? "done" : fresh >= 0 && fresh <= WORKING_FRESH_MS ? "working" : "idle";
  const summary = row.summary ?? null;
  return {
    id: `${row.provider}:${row.sessionId}`,
    tool: row.provider,
    accountId: accountId(row.provider, row.profile),
    project: basename(cwd),
    cwd,
    branch: null,
    title: summary ?? `Session ${row.sessionId.slice(0, 8)}`,
    state,
    startedAt: row.birthtimeMs ?? row.mtimeMs,
    lastActiveAt: row.mtimeMs,
    contextPct: row.context?.pct ?? null,
    model: row.context?.model ?? null,
    summary,
    why: [],
    protectionNote: null,
    surface: null,
  };
}

const TOOL_META: Record<ToolingEntry["id"], { name: string; role: string }> = {
  "agent-config": { name: "agent-config", role: "Skills, rules and knowledge map for your agents" },
  rtk: { name: "rtk", role: "Token killer — trims tool output" },
  claude: { name: "Claude Code", role: "Claude CLI" },
  codex: { name: "Codex CLI", role: "Codex CLI" },
  agy: { name: "Antigravity CLI", role: "agy" },
};

export function toolFromEntry(e: ToolingEntry, latest: string | null = null): ToolEntry {
  const meta = TOOL_META[e.id];
  return {
    id: e.id,
    name: meta.name,
    role: meta.role,
    present: e.present,
    version: e.version,
    latest,
    healthy: e.healthy,
    hint: e.hint || undefined,
    path: e.path,
    command: `agent-switch tooling ${e.present ? "upgrade" : "install"} ${e.id}`,
  };
}

export function agentConfigFromStatus(s: AcStatus | null, latest: string | null, checkedAt: number | null): AgentConfigVm {
  if (!s) return { status: "unknown", port: null, pid: null, version: null, latest, checkedAt };
  switch (s.status) {
    case "live":
      return { status: "live", port: s.port, pid: s.pid, version: s.version, latest, checkedAt };
    case "wedged":
      return { status: "wedged", port: s.port, pid: s.pid, version: null, latest, checkedAt };
    case "notRunning":
      return { status: "not-running", port: null, pid: null, version: null, latest, checkedAt };
    case "notInstalled":
      return { status: "not-installed", port: null, pid: null, version: null, latest, checkedAt };
  }
}

const NOTICE_TONE: Record<AppNotification["kind"], Notice["tone"]> = {
  success: "ok",
  error: "alert",
  warning: "warn",
  info: "info",
};

/** `lastRead` is the shared read-marker the legacy bell also uses. */
export function noticeFromNotification(n: AppNotification, lastRead: number): Notice {
  return { id: n.id, title: n.title, detail: n.message, at: n.ts, unread: n.ts > lastRead, tone: NOTICE_TONE[n.kind] };
}

const BIN_NAME: Record<keyof ProvidersStatus, string> = { claude: "claude", codex: "codex", antigravity: "agy" };

export function providersFromStatus(ps: ProvidersStatus): Provider[] {
  return (Object.keys(ps) as (keyof ProvidersStatus)[]).map((id) => ({
    id,
    installed: ps[id].installed,
    binaryPath: ps[id].binaryPath ?? null,
    binName: BIN_NAME[id],
    cli: ps[id].cli,
    gui: ps[id].ui,
  }));
}

/** Registered launchable apps. What each app supports is not reported by any
 *  backend, so capability/protection stay null. */
export function surfacesFromApps(apps: AppInfo[]): Surface[] {
  return apps.map((a) => ({
    id: a.id,
    tool: a.provider,
    name: a.displayName,
    kind: "desktop",
    detected: a.installed,
    capability: null,
    protection: null,
    identitySeen: null,
    launcher: null,
    checkedAt: null,
  }));
}

/** The attention queue from what the backend reports today: fresh near-limit /
 *  limited readouts and available tool updates. Stale usage raises nothing —
 *  an old number must not page the user. */
export function deriveAttention(accounts: Account[], tools: ToolEntry[], toolsCheckedAt: number | null, now: number): Attention[] {
  const out: Attention[] = [];
  for (const a of accounts) {
    if ((a.state !== "near-limit" && a.state !== "limited") || isStale(a.checkedAt, now)) continue;
    const w = bindingWindow(a.windows);
    if (!w || w.utilization == null || a.checkedAt == null) continue;
    const resets = countdown(w.resetsAt, now);
    out.push({
      id: `limit:${a.id}`,
      kind: "near-limit",
      title: `${a.name} is at ${w.utilization} % of its ${w.label} window`,
      detail: resets ? `Resets in ${resets}.` : "Reset time not reported.",
      accountId: a.id,
      primary: "Decide",
      at: a.checkedAt,
    });
  }
  const updates = tools.filter((t) => toolStatus(t) === "update");
  if (updates.length && toolsCheckedAt != null) {
    const [first, ...rest] = updates;
    out.push({
      id: "update:tools",
      kind: "update",
      title: `${first.name} ${first.latest} is out`,
      detail:
        `You have ${first.version}.` +
        (rest.length ? ` ${rest.map((t) => t.name).join(", ")} ${rest.length === 1 ? "has an update" : "have updates"} too.` : "") +
        " Running sessions are not touched.",
      primary: "See updates",
      at: toolsCheckedAt,
    });
  }
  return out.sort((x, y) => y.at - x.at);
}

/** starting until the first load lands; needs-action when the CLI itself did
 *  not answer; degraded when some readout failed. */
export function deriveReadiness(loaded: boolean, cliAnswered: boolean, partialFailure: boolean): Readiness {
  if (!loaded) return "starting";
  if (!cliAnswered) return "needs-action";
  return partialFailure ? "degraded" : "ready";
}
