/**
 * Design fixture scene: the real v3 window (V3Window) with the demo data of the
 * reference boards, plus the screens that live outside it (tray, first run,
 * markdown, hints, Claude settings). No IPC, no engine. Used by design.html
 * (main.tsx) and by the Claude Design embed (embed.tsx). Not shipped.
 */
import { useState, type CSSProperties } from "react";
import "../../index.css";
import { AcRoot } from "../../ui/AcRoot.js";
import { themeById } from "../themes/registry.js";
import { DEFAULT_APPEARANCE, resolveTheme, type Accent } from "../themes/resolve.js";
import { SESSION_MENU, V3Window, type V3Data, type V3Slots } from "../window.js";
import type { WindowLayout } from "../layout.js";
import { V3Tray } from "../tray.js";
import { FirstRun } from "../firstrun.js";
import { ChatTimeline } from "../chat.js";
import { EarlierNotShown } from "../subagent-view.js";
import type { AsEvent } from "../timeline.js";
import CHAT from "../fixtures/timeline-claude-2.1.316.json";
import { ToolsPage, allNeeds } from "../tools.js";
import { ExternalBody, HostedTerminal } from "../workbench.js";
import type { LimitAccount } from "../limits.js";
import type { RowSession } from "../sessions.js";
import type { TableSession } from "../pages.js";
import type { ChangedFile, SummaryFacts } from "../panels.js";
import { Review } from "../review.js";
import type { ReviewFileJson } from "../../ipc.js";
import type { TermBackend } from "../../terminal.js";
import { TERMINALS } from "./terminal.js";
import { Bubble } from "../chat.js";
import { FIXTURES } from "../markdown/fixtures.js";
import { Markdown } from "../markdown/Markdown.js";
import { HintStrip, type BarSession } from "../workbench.js";
import { ClaudeSettings } from "../../redesign/screens/settings/claude.js";
import { SettingsPage } from "../settings.js";
import { ASProvider } from "../../vm/store.js";
import { emptyViewModel } from "../../vm/load.js";

const NOW = Date.now();
const MIN = 60_000;
const H = 60 * MIN;

const L = (label: string, used: number | null, resetsIn: number | null, pace: number | null) => ({ label, used, resetsAtMs: resetsIn == null ? null : NOW + resetsIn, pace });

const LIMITS: LimitAccount[] = [
  { identity: "work@example.com", plan: "Max", key: "claude/work", tool: "claude", name: "work", color: "teal", protect: 95, next: true, signIn: false, checkedMs: NOW - MIN, windows: [L("5h", 39, 2 * H + 10 * MIN, 45), L("week", 62, 118 * H, 30), L("week · Opus", 71, 118 * H, 30)] },
  { identity: "me@example.com", plan: "Pro", key: "claude/personal", tool: "claude", name: "personal", color: "pink", protect: 98, next: false, signIn: false, checkedMs: NOW - 2 * MIN, windows: [L("5h", 12, 4 * H, 20), L("week", 23, 53 * H, 70)] },
  { identity: "side@example.com", plan: "Pro", key: "claude/side", tool: "claude", name: "side", color: "purple", protect: 98, next: false, signIn: false, checkedMs: NOW, windows: [L("5h", 94, H + 18 * MIN, 74), L("week", 29, 53 * H, 70)] },
  { identity: "work@example.com", plan: "Plus", key: "codex/work", tool: "codex", name: "work", color: "teal", protect: 90, next: false, signIn: false, checkedMs: NOW - 14 * MIN, windows: [L("5h", 30, 3 * H + 12 * MIN, 35), L("week", 22, 97 * H, 40)] },
  { identity: "me@example.com", plan: null, key: "codex/personal", tool: "codex", name: "personal", color: "pink", protect: 90, next: false, signIn: true, checkedMs: null, windows: [] },
];

/** A row as the adapter builds it: the tool from the key, the account's colour from its limits entry. */
const S = (s: Partial<RowSession> & Pick<RowSession, "key" | "title" | "state">): RowSession => {
  const tool = s.key.split("/")[0] as "claude" | "codex";
  const account = s.account ?? { name: "work", nearLimit: false };
  return { branch: null, pr: null, children: [], needsYou: false, ...s, tool, account: { ...account, color: LIMITS.find((l) => l.key === `${tool}/${account.name}`)?.color } };
};

/** The subagents' own transcripts, by agent id: what the subagent board opens. */
const SUBAGENT_RUNS: Record<string, AsEvent[]> = {
  c2: [
    { t: "tool.started", id: "t1", name: "Edit", summary: "src/engine/stores.ts", input: { file_path: "src/engine/stores.ts" }, parentToolId: null },
    { t: "tool.finished", id: "t1", ok: true, summary: "" },
    { t: "message", id: "m1", role: "assistant", text: "Moved sessions.json and arms.json into the event store; the JSON files stay as a read-only fallback. Running the store tests.", images: 0 },
    { t: "tool.started", id: "t2", name: "Bash", summary: "npm test -- store", input: { command: "npm test -- store" }, parentToolId: null },
  ],
};

const SESSIONS: RowSession[] = [
  S({ key: "claude/work/s-store", title: "v3 engine: event store + ingest", state: "working", branch: "feat/event-store", pr: { number: 142, ci: "PENDING", mergeable: "MERGEABLE" },
    children: [
      { id: "c1", label: "Explore · schema of sessions.json", kind: "subagent", state: "done", source: "hook" },
      { id: "c2", label: "general-purpose · migrate JSON stores", kind: "subagent", state: "working", source: "files", doing: "Bash · npm test -- store", startedMs: NOW - 6 * MIN },
      { id: "c3", label: "code-reviewer · ingest dedupe", kind: "subagent", state: "working", source: "hook", doing: "Read · src/engine/ingest.ts", startedMs: NOW - 2 * MIN },
    ] }),
  S({ key: "claude/personal/s-themes", title: "Theme system, Darcula default", state: "needs-you", account: { name: "personal", nearLimit: false }, branch: "feat/themes", pr: { number: 145, ci: "SUCCESS", mergeable: "MERGEABLE" }, needsYou: true }),
  S({ key: "codex/work/s-hook", title: "as-hook p95 benchmark", state: "idle", branch: "perf/as-hook", children: [{ id: "c9", label: "subagent rollouts, content not read", kind: "subagent", state: "done", source: "counted", count: 2 }] }),
  S({ key: "claude/work/s-council", title: "Release plan agent-config 1.9", state: "working", branch: "main",
    children: [
      { id: "k1", label: "Council seat · architect", kind: "council-seat", state: "done", source: "lineage" },
      { id: "k2", label: "Council seat · skeptic", kind: "council-seat", state: "working", source: "lineage" },
      { id: "k3", label: "Council seat · release manager", kind: "council-seat", state: "working", source: "lineage" },
    ] }),
  S({ key: "claude/side/s-wedge", title: "Fix wedge on daemon restart", state: "working", account: { name: "side", nearLimit: true }, branch: "fix/wedge-restart", pr: { number: 88, ci: "SUCCESS", mergeable: "MERGEABLE" } }),
  S({ key: "claude/personal/s-notes", title: "Release notes 2.11", state: "done", account: { name: "personal", nearLimit: false }, branch: "docs/release-2.11", pr: { number: 140, ci: "SUCCESS", mergeable: "MERGEABLE" }, doneToday: true }),
  S({ key: "claude/personal/s-checkout", title: "Checkout flow accessibility", state: "needs-you", account: { name: "personal", nearLimit: false }, branch: "a11y/checkout", pr: { number: 311, ci: "FAILURE", mergeable: "CONFLICTING" }, needsYou: true,
    children: [{ id: "u1", label: "claude --print in /tmp/tmp.k2J9", kind: "unknown", state: "done", source: "unknown" }] }),
];

const BAR: Record<string, { model: string; thinking: string; ctx: number; hosted: boolean; acct: string; color: "teal" | "pink" | "purple"; five: number; protect: number }> = {
  "claude/work/s-store": { model: "Opus 5.5", thinking: "High", ctx: 58, hosted: true, acct: "work", color: "teal", five: 39, protect: 95 },
  "claude/personal/s-themes": { model: "Opus 5.5", thinking: "High", ctx: 21, hosted: true, acct: "personal", color: "pink", five: 12, protect: 98 },
  "codex/work/s-hook": { model: "default", thinking: "medium", ctx: 33, hosted: false, acct: "work", color: "teal", five: 30, protect: 90 },
  "claude/work/s-council": { model: "Opus 5.5", thinking: "High", ctx: 44, hosted: true, acct: "work", color: "teal", five: 39, protect: 95 },
  "claude/side/s-wedge": { model: "Sonnet 5.5", thinking: "Medium", ctx: 47, hosted: true, acct: "side", color: "purple", five: 94, protect: 98 },
  "claude/personal/s-notes": { model: "Sonnet 5.5", thinking: "Low", ctx: 12, hosted: true, acct: "personal", color: "pink", five: 12, protect: 98 },
  "claude/personal/s-checkout": { model: "Opus 5.5", thinking: "High", ctx: 71, hosted: true, acct: "personal", color: "pink", five: 12, protect: 98 },
};

/** The Changes window's list; Summary's count is its length, as in the app. */
const CHANGES: ChangedFile[] = [
  { status: "M", path: "src/engine/ingest.ts", added: 38, removed: 6 },
  { status: "A", path: "src/engine/store.ts", added: 112, removed: 0 },
  { status: "A", path: "src/engine/schema.sql", added: 64, removed: 0 },
  { status: "M", path: "src/engine/projection.ts", added: 21, removed: 4 },
  { status: "A", path: "tests/engine/ingest.test.ts", added: 77, removed: 0 },
];

/** Each session's own changed files, so Summary, Changes and Review follow the selected session. */
const CHANGES_OF: Record<string, ChangedFile[]> = {
  "claude/work/s-store": CHANGES,
  "claude/personal/s-themes": [
    { status: "M", path: "gui/src/v3/themes/registry.ts", added: 3, removed: 3 },
    { status: "M", path: "gui/src/v3/themes/resolve.ts", added: 8, removed: 2 },
    { status: "A", path: "gui/src/v3/themes/darcula.test.ts", added: 41, removed: 0 },
  ],
  "claude/personal/s-checkout": [
    { status: "M", path: "src/checkout/PaymentStep.vue", added: 24, removed: 9 },
    { status: "M", path: "tests/e2e/checkout.spec.ts", added: 6, removed: 2 },
  ],
  "claude/side/s-wedge": [{ status: "M", path: "src/daemon/lease.ts", added: 12, removed: 4 }],
  "claude/personal/s-notes": [{ status: "A", path: "docs/release-2.11.md", added: 86, removed: 0 }],
};
const changesOf = (key: string) => CHANGES_OF[key] ?? [];

/** Review files for the fixture: one small hunk per changed file. */
const reviewFiles = (key: string): ReviewFileJson[] =>
  changesOf(key).map((f, i) => ({
    path: f.path,
    status: f.status as ReviewFileJson["status"],
    added: f.added,
    removed: f.removed,
    hunks: [
      {
        oldStart: 12,
        newStart: 12,
        layer: i === 0 ? "turn" : "unstaged",
        hash: `h${i}`,
        header: "@@ -12,4 +12,5 @@",
        lines: f.status === "A" ? ["+// new file", `+export const added = ${f.added};`] : [" const before = true;", "-const old = load();", `+const next = load({ dedupe: true }); // +${f.added} −${f.removed}`, " export { next };"],
      },
    ],
  }));

const iso = (ago: number) => new Date(NOW - ago).toISOString();

const resetsText = (ms: number | null) => {
  if (ms === null) return "unknown";
  const mins = Math.max(0, Math.round((ms - NOW) / MIN));
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
};

/** The decision sheet for the subject it is opened for, as the adapter's decisionFor builds it:
 *  an account (`claude/side`) moves its live sessions, a session (`claude/work/<id>`) only itself. */
function decisionFor(subject: string): ReturnType<V3Data["decision"]> {
  const [tool, name] = subject.split("/");
  const only = subject.split("/").length === 3 ? subject : null;
  const acct = LIMITS.find((l) => l.key === `${tool}/${name}`);
  const w = acct?.windows.find((x) => x.label === "5h") ?? acct?.windows[0];
  if (!acct || !w) return null;
  const others = LIMITS.filter((l) => l.tool === acct.tool && l.key !== acct.key && !l.signIn).sort((a, b) => (a.windows[0]?.used ?? 100) - (b.windows[0]?.used ?? 100));
  const target = others[0]?.name ?? "";
  const moving = SESSIONS.filter((s) => (only ? s.key === only : s.key.startsWith(`${acct.key}/`) && s.state !== "done"));
  return {
    account: acct.name,
    tool: acct.tool,
    nearLimit: acct.windows.some((x) => (x.used ?? 0) >= 90),
    targets: others.map((l) => ({ name: l.name, color: l.color })),
    pctUsed: w.used ?? 0,
    window: w.label,
    resetsIn: resetsText(w.resetsAtMs),
    sessions: moving.map((s) => ({ key: s.key, title: s.title, model: BAR[s.key]?.model ?? null, target, state: s.state })),
    suggestion: target,
    suggestionWhy: "the most room left",
  };
}

export function makeData(o: { theme: string; accent: Accent; health?: string; away?: boolean; chat?: (key: string) => boolean }): V3Data {
  const THEME = o.theme;
  const ACCENT = o.accent;
  return {
  nowMs: NOW,
  health: o.health === "down" ? { state: "down", sinceMs: NOW - 2 * MIN, hostedRunning: 4 } : { state: "ready" },
  needs: [
    { id: "n1", kind: "approval", subject: "claude/personal/s-themes", who: "Theme system", what: "wants to run", detail: "npx vitest run src/v3", verb: "Allow", since: iso(MIN), version: "1" },
    { id: "n5", kind: "question", subject: "claude/personal/s-checkout", who: "Checkout flow", what: "asks you", detail: "“Rebase first?”", verb: "Reply", since: iso(12 * MIN), version: "1" },
    { id: "n2", kind: "limit", subject: "claude/side", who: "side", what: "94% of 5h", detail: "resets in 1h 18m · 1 session on it", verb: "Decide", since: iso(3 * MIN), version: "1" },
    { id: "n6", kind: "ci", subject: "claude/personal/s-checkout", who: "#311", what: "CI failing", detail: "e2e (chromium) · Checkout flow", verb: "Fix", since: iso(20 * MIN), version: "1" },
    { id: "n3", kind: "signin", subject: "codex/personal", who: "Codex · personal", what: "sign in", detail: "stored login expired", verb: "Sign in", since: iso(41 * MIN), version: "1" },
  ],
  away: o.away ? { finishedTurns: 3, stoppedOnError: 1, resolved: 2, mergedPrs: 1, ciBreaks: 1 } : null,
  history: [
    { id: "h1", who: "Fix wedge on daemon restart", what: "finished", doneAt: iso(2 * H) },
    { id: "h2", who: "v3 engine", what: "subagent “Explore” done", doneAt: iso(12 * MIN) },
    { id: "h3", who: "work", what: "refreshed its sign-in", doneAt: iso(H) },
  ],
  sessions: SESSIONS,
  limits: LIMITS,
  accounts: LIMITS.map((a, i) => ({ ...a, email: a.tool === "codex" ? null : `${a.name}@example.com`, label: ["Work", "Personal", "Other", "Work", "Personal"][i], isDefault: a.name === "work", running: [2, 2, 1, 1, 0][i] })),
  table: SESSIONS.map((s, i): TableSession => ({ key: s.key, title: s.title, state: s.state, live: s.state !== "done", tool: s.key.startsWith("codex") ? "codex" : "claude", account: { name: s.account.name, color: BAR[s.key].color }, branch: s.branch, pr: s.pr && { number: s.pr.number, ci: s.pr.ci }, model: BAR[s.key].model, thinking: BAR[s.key].thinking, contextPct: BAR[s.key].ctx, lastActiveMs: NOW - i * 7 * MIN, project: "agent-switch", when: s.doneToday ? ("done" as const) : ("active" as const) })).concat([
    // Quiet for days, still in the transcript list: the footer's "Older than a day".
    { key: "claude/work/s-old-docs", title: "Docs site search index", state: "idle", live: true, tool: "claude", account: { name: "work", color: "teal" }, branch: "docs/search", pr: null, model: "Sonnet 5.5", thinking: "Medium", contextPct: 22, lastActiveMs: NOW - 3 * 24 * H, project: "agent-switch", when: "older" as const },
    { key: "claude/personal/s-old-spike", title: "Spike: tmux control mode", state: "done", live: false, tool: "claude", account: { name: "personal", color: "pink" }, branch: "spike/tmux-cc", pr: null, model: "Opus 5.5", thinking: "High", contextPct: 64, lastActiveMs: NOW - 6 * 24 * H, project: "agent-switch", when: "older" as const },
  ]),
  library: [
    { key: "l1", name: "Rebind ADR discussion", summary: "Why live rebind stays explicit; provider/version checks; recovery path", tags: ["adr", "rebind"], color: "teal", project: "agent-switch", branch: "docs/adr-003", pr: { number: 120, lifecycle: "merged" }, lastMs: NOW - 6 * 24 * H, pinned: true, archived: false, vault: { state: "saved", bytes: 2_400_000 }, transcript: true },
    { key: "l2", name: "v3 engine: event store + ingest", summary: "M1 schema, WAL, dedupe per producer", tags: ["v3", "engine"], color: "teal", project: "agent-switch", branch: "feat/event-store", pr: { number: 142, lifecycle: "open" }, lastMs: NOW, pinned: true, archived: false, vault: { state: "saved", bytes: 8_100_000 }, transcript: true },
    { key: "l3", name: "Release notes 2.11", summary: "Changelog, screenshots, store text", tags: [], color: "pink", project: "agent-switch", branch: "main", pr: null, lastMs: NOW - 29 * 24 * H, pinned: false, archived: false, vault: { state: "none", cleanupInDays: 3 }, transcript: true },
    { key: "l4", name: "Pools migration spike", summary: "Tags → pools suggestion, never auto-created", tags: ["pools"], color: "purple", project: "agent-switch", branch: "spike/pools", pr: null, lastMs: NOW - 52 * 24 * H, pinned: true, archived: true, vault: { state: "unavailable" }, transcript: false },
  ],
  vaultBytes: 11_600_000,
  autoKeep: true,
  tools: [
    { id: "claude", name: "Claude Code", role: "agent", present: true, version: "2.4.1", latest: "2.4.1", healthy: true, path: "/usr/local/bin/claude" },
    { id: "codex", name: "Codex CLI", role: "agent", present: true, version: "0.148.0", latest: "0.150.0", healthy: true, path: "/opt/homebrew/bin/codex" },
  ],
  palette: [
    { id: "claude/work/s-store", group: "sessions", title: "v3 engine: event store + ingest", meta: "work · feat/event-store", state: "working" },
    { id: "lib:l1", group: "sessions", title: "Rebind ADR discussion", meta: "Library · kept · Oct 28", state: "idle", old: true },
    { id: "pr:claude/work/s-store", group: "branches", title: "#142 engine: SQLite event store (M1)", meta: "open · agent-switch" },
    { id: "cmd:move", group: "commands", title: "Move session to another account…", meta: "opens the decision sheet", hint: "⌘⇧M" },
  ],
  appearance: { ...DEFAULT_APPEARANCE, ...(themeById(THEME).mode === "dark" ? { dark: THEME } : { light: THEME }), mode: themeById(THEME).mode, accent: ACCENT },
  prefersDark: true,
  openIn: {
    targets: [
      { target: "vscode", label: "VS Code", kind: "editor", installed: true, app: null, launcher: "/usr/local/bin/code" },
      { target: "phpstorm", label: "PhpStorm", kind: "editor", installed: true, app: "/Applications/PhpStorm.app", launcher: "/usr/local/bin/phpstorm" },
      { target: "cursor", label: "Cursor", kind: "editor", installed: false },
      { target: "idea", label: "IntelliJ IDEA", kind: "editor", installed: false },
      { target: "terminal", label: "Terminal", kind: "terminal", installed: true },
      { target: "finder", label: "Finder", kind: "files", installed: true },
    ],
    defaultTarget: "phpstorm",
    lastUsed: "vscode",
    perRepo: { "~/code/event4u-web": "vscode" },
    focusTerminal: true,
    agentApps: [
      { id: "claude-desktop", label: "Claude Desktop", tool: "claude" },
      { id: "codex-desktop", label: "Codex Desktop", tool: "codex" },
    ],
  },
  agents: {
    rows: [
      { id: "claude", name: "Claude Code", binary: "claude", cls: "deep", enabled: true, version: "2.4.1", local: null },
      { id: "codex", name: "Codex", binary: "codex", cls: "deep", enabled: true, version: "0.150.0", local: null },
      { id: "opencode", name: "OpenCode", binary: "opencode", cls: "acp", enabled: true, version: "2.2.5", local: { runner: "ollama", model: "qwen3-coder:30b" } },
    ],
    suggestions: [{ id: "goose", name: "Goose", install: ["brew", "install", "block-goose-cli"] }],
  },
  remote: { remoteControl: [], ssh: false },
  newSession: {
    initial: { folder: "~/code/agent-switch", gitState: "main · clean", worktree: false, tool: "claude", model: "Opus 5.5", thinking: "High", where: "terminal", remembered: true },
    facts: { terminalApp: "Terminal.app", hosting: "persistent", thinkingLevels: { claude: ["Low", "Medium", "High", "Max"], codex: ["low", "medium", "high"], antigravity: ["default"] }, account: { name: "work", color: "teal", reason: "most room in pool “day”", limits: LIMITS[0], why: ["Folder rule: ~/code/agent-switch → pool day", "work has the most room in day"], paceText: "At today's pace: about 3h of Opus · High before the 5h window is full" }, command: "agent-switch run --provider claude --cwd ~/code/agent-switch --model opus --effort high --new-window", nowMs: NOW, models: { claude: [{ id: "opus", label: "Opus" }, { id: "sonnet", label: "Sonnet" }, { id: "haiku", label: "Haiku" }], codex: [], antigravity: [] }, folders: ["~/code/agent-switch"], home: null, accounts: { claude: [{ name: "work", color: "teal" }, { name: "personal", color: "pink" }], codex: [], antigravity: [] } },
  },
  decision: decisionFor,
  // The adapter's menuFor with this fixture's persistent hosting: Detach never; End and Compact
  // only hosted; Take over only a session in your own terminal.
  menu: (key) => SESSION_MENU.filter((item) => item !== "Detach" && (item === "End…" || item === "Compact" ? !!BAR[key]?.hosted : item === "Take over here…" ? !BAR[key]?.hosted : true)),
  models: (key) =>
    key.startsWith("codex")
      ? { models: [], current: null, thinking: ["minimal", "low", "medium", "high"], currentThinking: "medium" }
      : {
          models: [
            { id: "opus", label: "Opus 5.5", hint: "deepest · uses the most limit" },
            { id: "sonnet", label: "Sonnet 5.5", hint: "balanced" },
            { id: "haiku", label: "Haiku 5.5", hint: "fast · light on limits" },
          ],
          current: BAR[key]?.model.startsWith("Sonnet") ? "sonnet" : "opus",
          thinking: ["low", "medium", "high", "max"],
          currentThinking: BAR[key]?.thinking.toLowerCase() ?? null,
        },
  bar: (key) => {
    const b = BAR[key];
    return b ? { key, hosted: b.hosted, chatAvailable: b.hosted, view: o.chat?.(key) && b.hosted ? "chat" : "terminal", account: { name: b.acct, color: b.color, fiveH: b.five, protect: b.protect }, model: b.model, thinking: b.thinking, contextPct: b.ctx } : null;
  },
  summary: (key) =>
    !key.endsWith("s-checkout") && !key.endsWith("s-store")
      ? otherSummary(key)
      : key.endsWith("s-checkout")
      ? { next: { text: "CI fails on e2e and the branch conflicts with main. One prompt: rebase, then fix e2e (log attached).", action: "Send to agent" }, pr: { number: 311, url: "#", ci: "FAILURE", lifecycle: "OPEN", mergeable: "CONFLICTING", review: "CHANGES_REQUESTED", failingChecks: ["e2e (chromium)"] }, git: { branch: "a11y/checkout", worktree: false, changed: changesOf("claude/personal/s-checkout").length, ahead: 5, behind: 9 }, limit: null, more: { id: "claude:personal/7a1c…e02", host: "tmux · as-personal-2", library: "not pinned", children: "1 related session" } }
      : { next: { text: "#142 needs a review; you'll hear when CI is done.", action: "Request review" }, pr: { number: 142, url: "#", ci: "PENDING", lifecycle: "OPEN", mergeable: "MERGEABLE", review: "REVIEW_REQUIRED", failingChecks: [] }, git: { branch: "feat/event-store", worktree: true, changed: changesOf("claude/work/s-store").length, ahead: 3, behind: 0 }, limit: null, more: { id: "claude:work/9f2c…e41a", host: "tmux · as-work-3", library: "pinned · in vault", children: "3 subagents" } },
  changes: (key) => changesOf(key),
  next: (key) => (key.endsWith("s-checkout") ? { text: "CI fails on e2e and the branch conflicts with main. One prompt: rebase, then fix e2e (log attached).", action: "Send to agent" } : null),
  };
}

/** A pty that prints a recorded Claude Code screen and then idles. */
const fakeBackend = (key: string): TermBackend => ({
  async open(_args, _rows, _cols, onEvent) {
    setTimeout(() => onEvent({ kind: "data", data: TERMINALS[key] ?? TERMINALS.default }), 50);
    return 1;
  },
  async write() {},
  async resize() {},
  async close() {},
});

/** Summary for a session without a hand-written one, from its row. */
function otherSummary(key: string): SummaryFacts | null {
  const s = SESSIONS.find((x) => x.key === key);
  if (!s) return null;
  const pr = s.pr && { number: s.pr.number, url: "#", ci: s.pr.ci, lifecycle: "OPEN", mergeable: s.pr.mergeable ?? "MERGEABLE", review: "NONE", failingChecks: [] };
  const next = s.needsYou ? { text: "It waits for your answer in Needs you.", action: "Focus terminal" } : s.state === "done" ? { text: `#${s.pr?.number} is green; merge when you're ready.`, action: "Open PR" } : null;
  return { next, pr, git: s.branch ? { branch: s.branch, worktree: false, changed: changesOf(key).length, ahead: 1, behind: 0 } : null, limit: null, more: { id: key, host: BAR[key]?.hosted ? "tmux · as-" + BAR[key].acct : "Terminal.app · tab 3", library: "not pinned", children: s.children.length ? `${s.children.length} related` : "none" } };
}

export interface SceneOptions {
  /** A board name (embed.tsx) or one of the fixture's own: markdown, claude-settings, hints, tray, tray-codex, firstrun. */
  view?: string;
  theme?: string;
  accent?: Accent;
  health?: string;
  away?: boolean;
  /** Hosted sessions open in the Chat view (the recorded Claude transcript). */
  chat?: boolean;
  /** Key glyphs and shortcuts; the embed pins mac so every board reads alike. */
  platform?: "mac" | "other";
  /** The window's remembered view (density, order, grouping), so a board names its state instead of toggling the default. */
  layout?: Partial<WindowLayout>;
}

/** One board: the real v3 window, or one of the screens that live outside it, on fixture data. */
export function Scene({ view = "main", theme = "darcula", accent = "theme", health, away, chat, platform, layout }: SceneOptions) {
  // The Terminal / Chat switch is live: the window asks for a view, the fixture keeps it per session.
  const [views, setViews] = useState<Record<string, "terminal" | "chat">>({});
  const inChat = (key: string) => (views[key] ?? (chat ? "chat" : "terminal")) === "chat";
  const data = makeData({ theme, accent, health, away, chat: inChat });
  const def = themeById(theme);
  const { vars } = resolveTheme(def, accent);
  const noop = () => {};
  const slots: V3Slots = {
    // A subagent's own transcript, never its parent's; the end of a long run, as the real view reads it.
    subagent: (_parent, agentId) => <ChatTimeline events={SUBAGENT_RUNS[agentId] ?? []} notice={<EarlierNotShown />} />,
    review: (key, focus) => (
      <Review
        title={SESSIONS.find((x) => x.key === key)?.title ?? key}
        scope="worktree"
        files={reviewFiles(key)}
        shared={[]}
        running={SESSIONS.find((x) => x.key === key)?.state === "working"}
        loading={false}
        error={null}
        undoable={false}
        focus={focus}
        on={{ setScope: noop, stage: noop, unstage: noop, discard: noop, undo: noop, comment: noop, commit: noop, createPr: noop }}
      />
    ),
    body: (key) =>
      BAR[key]?.hosted === false ? (
        <ExternalBody where="Terminal.app · tab 3" facts={<p>as-hook p95 benchmark · ~/code/agent-switch · perf/as-hook</p>} lastLine="as-hook is 6.7× faster at p95 (6.2 ms vs 41.8 ms)." onFocus={() => {}} onTakeOver={() => {}} />
      ) : inChat(key) ? (
        <div className="h-full overflow-y-auto bg-ac-bg px-6 py-4">
          <ChatTimeline events={CHAT.transcript as AsEvent[]} />
        </div>
      ) : (
        <HostedTerminal sessionKey={key} vars={vars} followTheme backend={fakeBackend(key)} onExit={() => {}} />
      ),
    usageHistory: <p className="text-[13px] text-ac-muted">(2.11 usage history)</p>,
    pools: <p className="text-[13px] text-ac-muted">(2.11 projects &amp; pools)</p>,
    poolCount: 4,
    tools: (
      <ToolsPage
        checking={false}
        on={{ check: () => {}, update: () => {}, install: () => {} }}
        rows={[
          { id: "claude", name: "Claude Code", where: "/usr/local/bin/claude", version: "2.4.1", status: "ok", latest: "2.4.1" },
          { id: "codex", name: "Codex CLI", where: "/opt/homebrew/bin/codex", version: "0.148.0", status: "update", latest: "0.150.0" },
          { id: "agent-config", name: "agent-config", where: "npm · global", version: "16.5.0", status: "ok", latest: "16.5.0" },
          { id: "tmux", name: "tmux", where: "/opt/homebrew/bin/tmux", version: "3.5a", status: "ok", latest: "3.5a" },
          { id: "gh", name: "gh", where: "/opt/homebrew/bin/gh · signed in", version: "2.62.0", status: "ok", latest: "2.62.0" },
        ]}
      />
    ),
    settings: (s) => <p className="text-[13px] text-ac-muted">{`(2.11 ${s} section)`}</p>,
  };
  if (view === "markdown") {
    // Agent markdown (road-to-a-chat-that-reads-well 2.4): every fixture as an assistant reply.
    return (
      <AcRoot className="h-full" mode={def.mode} style={vars as CSSProperties}>
        <div className="h-full space-y-4 overflow-y-auto bg-ac-bg px-6 py-4">
          <Bubble>Zeige mir die letzten 4 Änderungen als Tabelle</Bubble>
          {Object.entries(FIXTURES).map(([k, src]) => (
            <Markdown key={k} source={src} className="max-w-[86%]" />
          ))}
        </div>
      </AcRoot>
    );
  }
  if (view === "claude-settings") {
    // Settings › Claude Code with a made-up settings file (no IPC).
    const fake = async () => ({
      file: "~/.claude/settings.json",
      exists: true,
      valid: true,
      withheld: [],
      settings: {
        env: { CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: "1", DISABLE_AUTOUPDATER: "1" },
        permissions: { allow: ["Read(**)", "Bash(git *)", "Bash(ls *)", "Bash(cat *)", "Bash(grep *)", "Bash(rg *)", "Bash(npm *)", "Bash(npx *)", "Bash(gh pr view*)", "Bash(gh pr list*)", "Bash(gh run view*)", "Bash(make *)"], defaultMode: "auto" },
        model: "opus[1m]",
        enabledPlugins: { "typescript-lsp@claude-plugins-official": true },
        hooks: { Stop: [{ hooks: [{ type: "command", command: "x" }] }], PreToolUse: [{ hooks: [{}, {}] }] },
        theme: "dark",
        skipAutoPermissionPrompt: true,
      },
      profiles: [
        { name: "work", state: "in-sync" as const, extras: [] },
        { name: "side", state: "pending" as const, extras: ["permissions.allow (+17)", "enabledPlugins.typescript-lsp@claude-plugins-official"] },
        { name: "home", state: "linked" as const, extras: [] },
      ],
    });
    return (
      <AcRoot className="h-full" mode={def.mode} style={vars as CSSProperties}>
        <ASProvider initial={emptyViewModel()} actions={() => ({})}>
          <div className="flex h-full bg-ac-bg">
            <SettingsPage current="Claude Code" onSection={() => {}}>
              <div className="flex min-w-0 flex-col gap-5">
                <ClaudeSettings load={fake} />
              </div>
            </SettingsPage>
          </div>
        </ASProvider>
      </AcRoot>
    );
  }
  if (view === "hints") {
    // Usage hints (road-to-a-chat-that-reads-well 6.2), one strip per kind.
    const b = (o: Partial<BarSession>): BarSession => ({ key: "k", hosted: true, chatAvailable: true, view: "chat", account: { name: "work", color: "teal", fiveH: 20, protect: 95 }, model: "Opus 4.7", thinking: null, contextPct: 10, tool: "claude", contextTokens: 20_000, cache: null, ...o });
    const variants = [
      b({ account: { name: "work", color: "teal", fiveH: 97, protect: 95 } }),
      b({ contextPct: 66, contextTokens: 660_200 }),
      b({ contextPct: 88, contextTokens: 176_000 }),
      b({ cache: { state: "warm", ttl: "5m", lastResponseAt: null, expiresAt: new Date(Date.now() + 42_000).toISOString(), resendTokens: null, source: "transcript" }, contextTokens: 182_000 }),
      b({ cache: { state: "cold", ttl: null, lastResponseAt: "2026-11-05T08:00:00Z", expiresAt: null, resendTokens: 240_000, source: "transcript" } }),
    ];
    return (
      <AcRoot className="h-full" mode={def.mode} style={vars as CSSProperties}>
        <div className="h-full space-y-3 bg-ac-bg p-4">
          {variants.map((v, i) => (
            <div key={i} className="overflow-hidden rounded-[10px] border border-ac-line">
              <HintStrip s={v} dismissed={new Set()} onDismiss={() => {}} onAction={() => {}} />
            </div>
          ))}
        </div>
      </AcRoot>
    );
  }
  if (view === "tray" || view === "tray-codex") {
    const noop = () => {};
    return (
      <AcRoot className="h-full" mode={def.mode} style={vars as CSSProperties}>
        <div className="flex h-full items-start justify-center bg-ac-bg p-5">
          <V3Tray needs={allNeeds(data)} away={data.away} sessions={data.sessions} accounts={data.limits} nowMs={data.nowMs} ready appFor={(a) => (a.signIn ? undefined : { name: a.tool === "claude" ? "Claude Desktop" : "Codex Desktop", onOpen: noop })} on={{ verb: noop, moreNeeds: noop, away: noop, session: noop, moreSessions: noop, account: noop, signIn: noop, start: noop, open: noop }} />
        </div>
      </AcRoot>
    );
  }
  if (view === "firstrun") {
    const noop = () => {};
    return (
      <AcRoot className="h-full" mode={def.mode} style={vars as CSSProperties}>
        <FirstRun
          tools={[
            { id: "claude", name: "Claude Code", detail: "~/.claude · signed in as work@example.com", signedIn: true, installed: true },
            { id: "codex", name: "Codex CLI", detail: "~/.codex · signed in as work@example.com", signedIn: true, installed: true },
            { id: "antigravity", name: "Antigravity", detail: "not installed", signedIn: false, installed: false },
          ]}
          shell={{ file: "~/.zshrc", lines: ['eval "$(agent-switch shell-init zsh)"'] }}
          on={{ add: noop, install: noop, addAll: noop, addAnother: noop, applyShell: noop, done: noop }}
        />
      </AcRoot>
    );
  }
  return (
    <AcRoot className="h-full" mode={def.mode} style={vars as CSSProperties}>
      <V3Window data={data} slots={slots} platform={platform} layout={layout && { load: () => layout, save: () => {} }} act={(a) => (a.type === "view" ? setViews((v) => ({ ...v, [a.key]: a.view })) : console.log("[act]", JSON.stringify(a).slice(0, 200)))} />
    </AcRoot>
  );
}
