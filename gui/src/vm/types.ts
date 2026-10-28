/**
 * The redesign's view-model contract. Shapes follow the design's demo data
 * (bundle KR, app L1037–1061) — the demo VALUES never enter the product; every
 * field here is filled from `ipc.ts` or stays `null` / empty when no backend
 * reports it. Unknown is `null`, never `0`.
 */

/** Tools the redesign knows. `gemini` has no backend yet (ProviderId lacks it). */
export type Tool = "claude" | "codex" | "gemini" | "antigravity";

export type IdentityColor = "orange" | "red" | "yellow" | "green" | "teal" | "blue" | "purple" | "pink";
export const IDENTITY_COLORS: readonly IdentityColor[] = ["orange", "blue", "green", "purple", "yellow", "teal", "pink", "red"];

export type Tone = "ok" | "warn" | "alert" | "info" | "brand" | "violet" | "neutral";
export type MeterTone = "ok" | "warn" | "alert" | "neutral";

export interface UsageWindow {
  key: string;
  label: string;
  utilization: number | null;
  resetsAt: string | null;
}

export type AccountState = "ready" | "near-limit" | "checking" | "limited" | "wrong-account" | "signed-out";

export interface Protection {
  enabled: boolean;
  threshold: number;
}

export type AuthState = "connected" | "refreshing" | "expiring" | "sign-in-needed" | "wrong-account" | "unknown";

export interface AuthHealth {
  state: AuthState;
  expiresAt: number | null;
  lastRefreshAt: number | null;
  checkedAt: number | null;
  method: string | null;
  /** null = the provider offers no keep-signed-in refresh. */
  autoRefresh: boolean | null;
  reason?: string;
}

export interface Account {
  /** `<tool>:<name>` */
  id: string;
  tool: Tool;
  name: string;
  identity: string | null;
  plan: string | null;
  label: "Work" | "Personal" | "Other" | null;
  color: IdentityColor;
  /** "Use for plain starts" — today's active profile. */
  isDefault: boolean;
  state: AccountState;
  windows: UsageWindow[];
  /** Epoch ms of the usage readout; null = never read. */
  checkedAt: number | null;
  /** Codex banked resets; null = not reported. */
  resetCredits: number | null;
  /** Near-limit threshold the meters tick at (the configured notify threshold). */
  threshold: number;
  /** No protection engine yet → null (UI shows it as unavailable). */
  protection: Protection | null;
  auth: AuthHealth | null;
  surfaces: string[];
  liveSessions: number;
  pools: string[];
}

export type SessionState =
  | "working"
  | "waiting"
  | "needs-you"
  | "pause-requested"
  | "parked"
  | "auth-paused"
  | "idle"
  | "done";

export type SessionSurface = "terminal" | "desktop-app" | "ide";

export interface Session {
  id: string;
  tool: Tool;
  accountId: string;
  project: string;
  cwd: string;
  branch: string | null;
  title: string;
  state: SessionState;
  startedAt: number;
  lastActiveAt: number;
  contextPct: number | null;
  model: string | null;
  summary: string | null;
  why: string[];
  protectionNote: string | null;
  surface: SessionSurface | null;
  livenessUnknown?: boolean;
  trashed?: boolean;
}

export type AttentionKind = "near-limit" | "signed-out" | "reauth" | "health" | "update";

export interface Attention {
  id: string;
  kind: AttentionKind;
  title: string;
  detail: string;
  accountId?: string;
  sessionId?: string;
  primary: string;
  at: number;
}

export interface Check {
  id: string;
  title: string;
  detail: string;
  state: "ok" | "warn" | "fail";
  fix?: string;
}

export interface ReleaseNote {
  version: string;
  items: string[];
  url?: string;
}

export interface ToolEntry {
  id: string;
  name: string;
  role: string;
  present: boolean;
  version: string | null;
  /** null = latest not checked / not checkable. */
  latest: string | null;
  healthy: boolean;
  hint?: string;
  path?: string | null;
  command?: string;
  notes?: ReleaseNote[];
}

export type AgentConfigStatus = "live" | "not-running" | "wedged" | "not-installed" | "unknown";

export interface AgentConfigVm {
  status: AgentConfigStatus;
  port: number | null;
  pid: number | null;
  version: string | null;
  latest: string | null;
  checkedAt: number | null;
}

export type Capability = "native" | "opt-in-launch" | "monitor-only" | "unsupported" | "planned";

export interface Surface {
  id: string;
  tool: Tool;
  name: string;
  kind: "cli" | "desktop" | "ide";
  detected: boolean;
  /** null = no backend states what the app supports. */
  capability: Capability | null;
  protection: string | null;
  identitySeen: string | null;
  launcher: boolean | null;
  checkedAt: number | null;
  note?: string;
}

export type ActivityKind =
  | "start"
  | "rule"
  | "protection"
  | "limit"
  | "login"
  | "refresh"
  | "reset"
  | "repair"
  | "autostart"
  | "update";

export interface ActivityEvent {
  id: string;
  at: number;
  kind: ActivityKind;
  text: string;
  detail?: string;
  accountId?: string;
}

export interface Notice {
  id: string;
  title: string;
  detail: string;
  at: number;
  unread: boolean;
  tone: "info" | "ok" | "warn" | "alert";
}

export interface Provider {
  id: Tool;
  installed: boolean;
  binaryPath: string | null;
  binName: string;
  cli: boolean;
  /** null = the provider has no desktop app surface. */
  gui: boolean | null;
  planned?: boolean;
}

export interface Pool {
  id: string;
  label: string;
  accountIds: string[];
}

export interface Binding {
  id: string;
  match: { kind: "folder" | "repo" | "org"; value: string };
  tool: "any" | Tool;
  target: { kind: "account"; accountId: string } | { kind: "pool"; pool: string };
  enabled: boolean;
  /** null = no hit counter reported. */
  hits: number | null;
}

export type Readiness = "starting" | "ready" | "degraded" | "needs-action";

export interface ViewModel {
  now: number;
  accounts: Account[];
  sessions: Session[];
  rules: Binding[];
  pools: Pool[];
  attention: Attention[];
  checks: Check[];
  tools: ToolEntry[];
  toolsCheckedAt: number | null;
  agentConfig: AgentConfigVm;
  notices: Notice[];
  surfaces: Surface[];
  activity: ActivityEvent[];
  readiness: Readiness;
  autostart: { desired: "enabled" | "disabled" | null; actual: "enabled" | "disabled" | null };
  providers: Provider[];
  error: string | null;
  platform: "mac" | "windows" | "linux";
  hideSummaries: boolean;
  /** Epoch ms of the next usage refresh; null = no schedule known. */
  usageNextAt: number | null;
}
