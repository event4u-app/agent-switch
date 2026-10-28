/**
 * Pure builders: CLI `--json` rows (via ipc.ts types) → view-model entities.
 * No Tauri imports, so every mapping is unit-testable. Where the CLI reports
 * nothing (plan, a failed readout, surface capabilities) the field stays
 * null/empty — the screens render the design's honest unknown state.
 */

import type {
  AcStatus,
  ActivityEntry,
  AppInfo,
  AuthStatusRow,
  DoctorReport,
  GuardStatus,
  MappingRow,
  PoolListRow,
  ProtectionRow,
  ToolingEntry,
} from "../ipc.js";
import type { AppNotification } from "../notifications.js";
import type { ProfileRow, ProvidersStatus, SessionRow, UsageSnapshot } from "../transforms.js";
import { countdown } from "../ui/format.js";
import { TOOL_LABEL, bindingWindow, isStale, maxUtilization, toneFor, toolStatus } from "./rules.js";
import type {
  Account,
  AccountState,
  ActivityEvent,
  ActivityKind,
  AgentConfigVm,
  Attention,
  AuthHealth,
  Binding,
  Check,
  GuardVm,
  IdentityColor,
  Notice,
  Pool,
  Protection,
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

/** `claude/work` (the CLI's member key) → `claude:work`; null when it is not one. */
export function accountIdFromMember(key: string | null | undefined): string | null {
  const m = key ? /^(claude|codex|antigravity)\/(.+)$/.exec(key) : null;
  return m ? accountId(m[1], m[2]) : null;
}

/** signed-out when the provider's store says sign-in is needed; else limited at
 *  100 %, near-limit inside the warn band, ready otherwise. An unknown auth state
 *  never demotes an account. */
export function accountState(
  usage: UsageSnapshot | null | undefined,
  threshold: number,
  auth: Pick<AuthHealth, "state"> | null = null,
): AccountState {
  if (auth?.state === "sign-in-needed") return "signed-out";
  const max = usage ? maxUtilization(usage.windows) : null;
  if (max != null && max >= 100) return "limited";
  const tone = toneFor(max, threshold);
  return tone === "warn" || tone === "alert" ? "near-limit" : "ready";
}

/** What the per-account readouts beyond `list` contribute; each may be missing. */
export interface AccountExtras {
  protection?: Protection | null;
  auth?: AuthHealth | null;
  /** Ids of the pools listing this account. */
  pools?: string[];
}

export function accountFromProfile(row: ProfileRow, usage: UsageSnapshot | null | undefined, extras: AccountExtras = {}): Account {
  const id = accountId(row.provider, row.name);
  const protection = extras.protection ?? null;
  const auth = extras.auth ?? null;
  const threshold = protection?.thresholdPct ?? DEFAULT_THRESHOLD;
  return {
    id,
    tool: row.provider,
    name: row.name,
    identity: row.identity,
    plan: null,
    label: row.label,
    color: colorFor(id),
    isDefault: row.active,
    state: accountState(usage, threshold, auth),
    windows: usage ? usage.windows.map((w) => ({ ...w })) : [],
    checkedAt: parseTime(usage?.capturedAt),
    resetCredits: usage?.resetCredits ?? null,
    threshold,
    protection,
    auth,
    surfaces: [],
    liveSessions: row.liveSessions,
    pools: extras.pools ?? [],
  };
}

export function protectionFromRow(r: ProtectionRow): Protection {
  return { enabled: r.enabled, thresholdPct: r.thresholdPct };
}

/** `auth-status` → AuthHealth. The CLI reads the store, never refreshes it, so
 *  method / autoRefresh stay unknown; `checkedAt` is when the store was read. */
export function authFromStatus(r: AuthStatusRow, checkedAt: number): AuthHealth {
  return {
    state: r.state,
    expiresAt: parseTime(r.expiresAt),
    lastRefreshAt: parseTime(r.lastRefreshAt),
    checkedAt,
    method: null,
    autoRefresh: null,
    keptFreshBy: r.keptFreshBy || null,
    reason: r.detail || undefined,
  };
}

/** `pool list --json` → Pools; members become account ids, unparseable keys drop. */
export function poolsFromRows(rows: PoolListRow[]): Pool[] {
  return rows.map((p) => ({
    id: p.id,
    label: p.name,
    accountIds: p.members.map(accountIdFromMember).filter((x): x is string => x != null),
    rules: p.rules ?? [],
  }));
}

/** Pool ids per account id, for Account.pools. */
export function poolMembership(pools: Pool[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const p of pools) for (const a of p.accountIds) out.set(a, [...(out.get(a) ?? []), p.id]);
  return out;
}

/** Directory mappings → folder bindings. A mapping is always on and the CLI
 *  counts no hits. `pool:<id>` targets a pool; anything else is a profile. */
export function bindingsFromMappings(rows: MappingRow[]): Binding[] {
  return rows.map((r) => ({
    id: `${r.provider}:${r.path}`,
    match: { kind: "folder", value: r.path },
    tool: r.provider,
    target: r.target.startsWith("pool:")
      ? { kind: "pool", pool: r.target.slice("pool:".length) }
      : { kind: "account", accountId: accountId(r.provider, r.target) },
    enabled: true,
    hits: null,
  }));
}

const ACTIVITY_KIND: Record<ActivityEntry["kind"], ActivityKind> = {
  switch: "switch",
  rebind: "rebind",
  login: "login",
  redeem: "reset",
  autostart: "autostart",
  guard: "guard",
  update: "update",
  protection: "protection",
  pool: "pool",
  remove: "remove",
};

/** The CLI's activity log (oldest first) → events, newest first. Entries with an
 *  unreadable time are dropped rather than dated 0. */
export function activityFromEntries(entries: ActivityEntry[]): ActivityEvent[] {
  const out: ActivityEvent[] = [];
  entries.forEach((e, i) => {
    const at = parseTime(e.at);
    if (at == null) return;
    const acct = accountIdFromMember(e.target);
    out.push({
      id: `${e.at}#${i}`,
      at,
      kind: ACTIVITY_KIND[e.kind] ?? "update",
      text: e.target ? `${e.target}: ${e.action}` : e.action,
      detail: e.reason || undefined,
      ...(acct ? { accountId: acct } : {}),
      ok: e.ok,
    });
  });
  return out.sort((a, b) => b.at - a.at);
}

const CHECK_STATE: Record<DoctorReport["checks"][number]["status"], Check["state"]> = {
  ok: "ok",
  warn: "warn",
  error: "fail",
  info: "info",
};

export function checksFromDoctor(r: DoctorReport): Check[] {
  return r.checks.map((c) => ({ id: c.id, title: c.title, detail: c.detail, state: CHECK_STATE[c.status] ?? "warn", fix: c.fix }));
}

/** The CLI's doctor vocabulary → the design's. */
export function readinessFromDoctor(r: DoctorReport["readiness"]): Readiness {
  return r === "blocked" ? "needs-action" : r === "attention" ? "degraded" : "ready";
}

export function guardFromStatus(g: GuardStatus | null): GuardVm {
  if (!g) return { policy: null, loaded: [] };
  return { policy: g.policy, loaded: g.loaded.map((l) => ({ accountId: accountId(l.provider, l.name), sessions: l.sessions })) };
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
    if (a.state === "signed-out" && a.auth?.checkedAt != null) {
      out.push({
        id: `signin:${a.id}`,
        kind: "signed-out",
        title: `${TOOL_LABEL[a.tool]} · ${a.name} needs a new sign-in`,
        detail: a.auth.reason ?? "The stored login can no longer be refreshed.",
        accountId: a.id,
        primary: "Sign in",
        at: a.auth.checkedAt,
      });
      continue;
    }
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

const READINESS_RANK: Record<Readiness, number> = { starting: 0, ready: 1, degraded: 2, "needs-action": 3 };

/** starting until the first load lands; needs-action when the CLI itself did
 *  not answer; degraded when some readout failed. `doctor` (when it answered)
 *  can only make it worse, never better. */
export function deriveReadiness(
  loaded: boolean,
  cliAnswered: boolean,
  partialFailure: boolean,
  doctor: DoctorReport["readiness"] | null = null,
): Readiness {
  if (!loaded) return "starting";
  if (!cliAnswered) return "needs-action";
  const own: Readiness = partialFailure ? "degraded" : "ready";
  if (doctor == null) return own;
  const fromDoctor = readinessFromDoctor(doctor);
  return READINESS_RANK[fromDoctor] > READINESS_RANK[own] ? fromDoctor : own;
}
