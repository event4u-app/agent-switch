/**
 * Design fixture: the real v3 window (V3Window) with the demo data of the
 * reference boards, so the app and the design can be compared screen by screen.
 * No IPC, no engine. Open /design.html?theme=darcula&health=down|ready.
 * Not shipped: design.html is not in vite's build inputs.
 */
import type { CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import "../../index.css";
import { AcRoot } from "../../ui/AcRoot.js";
import { themeById } from "../themes/registry.js";
import { DEFAULT_APPEARANCE, resolveTheme, type Accent } from "../themes/resolve.js";
import { V3Window, type V3Data, type V3Slots } from "../window.js";
import { V3Tray } from "../tray.js";
import { ToolsPage } from "../tools.js";
import { ExternalBody, HostedTerminal } from "../workbench.js";
import type { LimitAccount } from "../limits.js";
import type { RowSession } from "../sessions.js";
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

const q = new URLSearchParams(location.search);
const THEME = q.get("theme") || "darcula";
const ACCENT = (q.get("accent") || "theme") as Accent;
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

const S = (s: Partial<RowSession> & Pick<RowSession, "key" | "title" | "state">): RowSession => ({ account: { name: "work", nearLimit: false }, branch: null, pr: null, children: [], needsYou: false, ...s });

const SESSIONS: RowSession[] = [
  S({ key: "claude/work/s-store", title: "v3 engine: event store + ingest", state: "working", branch: "feat/event-store", pr: { number: 142, ci: "PENDING", mergeable: "MERGEABLE" },
    children: [
      { id: "c1", label: "Explore · schema of sessions.json", kind: "subagent", state: "done", source: "hook" },
      { id: "c2", label: "general-purpose · migrate JSON stores", kind: "subagent", state: "working", source: "hook" },
      { id: "c3", label: "code-reviewer · ingest dedupe", kind: "subagent", state: "waiting", source: "hook" },
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

const iso = (ago: number) => new Date(NOW - ago).toISOString();

const data: V3Data = {
  nowMs: NOW,
  health: q.get("health") === "down" ? { state: "down", sinceMs: NOW - 2 * MIN, hostedRunning: 4 } : { state: "ready" },
  needs: [
    { id: "n1", kind: "approval", subject: "claude/personal/s-themes", who: "Theme system", what: "wants to run", detail: "npx vitest run src/v3", verb: "Allow", since: iso(MIN), version: "1" },
    { id: "n5", kind: "question", subject: "claude/personal/s-checkout", who: "Checkout flow", what: "asks you", detail: "“Rebase first?”", verb: "Reply", since: iso(12 * MIN), version: "1" },
    { id: "n2", kind: "limit", subject: "claude/side", who: "side", what: "94% of 5h", detail: "resets in 1h 18m · 1 session on it", verb: "Decide", since: iso(3 * MIN), version: "1" },
    { id: "n6", kind: "ci", subject: "claude/personal/s-checkout", who: "#311", what: "CI failing", detail: "e2e (chromium) · Checkout flow", verb: "Fix", since: iso(20 * MIN), version: "1" },
    { id: "n3", kind: "signin", subject: "codex/personal", who: "Codex · personal", what: "sign in", detail: "stored login expired", verb: "Sign in", since: iso(41 * MIN), version: "1" },
  ],
  away: q.get("away") ? { finishedTurns: 3, stoppedOnError: 1, resolved: 2, mergedPrs: 1, ciBreaks: 1 } : null,
  history: [
    { id: "h1", who: "Fix wedge on daemon restart", what: "finished", doneAt: iso(2 * H) },
    { id: "h2", who: "v3 engine", what: "subagent “Explore” done", doneAt: iso(12 * MIN) },
    { id: "h3", who: "work", what: "refreshed its sign-in", doneAt: iso(H) },
  ],
  sessions: SESSIONS,
  limits: LIMITS,
  accounts: LIMITS.map((a, i) => ({ ...a, email: a.tool === "codex" ? null : `${a.name}@example.com`, label: ["Work", "Personal", "Other", "Work", "Personal"][i], isDefault: a.name === "work", running: [2, 2, 1, 1, 0][i] })),
  table: SESSIONS.map((s, i) => ({ key: s.key, title: s.title, state: s.state, live: s.state !== "done", tool: s.key.startsWith("codex") ? "codex" : "claude", account: { name: s.account.name, color: BAR[s.key].color }, branch: s.branch, pr: s.pr && { number: s.pr.number, ci: s.pr.ci }, model: BAR[s.key].model, thinking: BAR[s.key].thinking, contextPct: BAR[s.key].ctx, lastActiveMs: NOW - i * 7 * MIN, project: "agent-switch" })),
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
    initial: { folder: "~/code/agent-switch", gitState: "main · clean", worktree: false, tool: "claude", model: "Opus 5.5", thinking: "High", where: "terminal" },
    facts: { terminalApp: "Terminal.app", hosting: "persistent", thinkingLevels: { claude: ["Low", "Medium", "High", "Max"], codex: ["low", "medium", "high"], antigravity: ["default"] }, account: { name: "work", color: "teal", reason: "most room in pool “day”", limits: LIMITS[0], why: ["Folder rule: ~/code/agent-switch → pool day", "work has the most room in day"], paceText: "At today's pace: about 3h of Opus · High before the 5h window is full" }, command: "agent-switch run claude --model opus --effort high", nowMs: NOW },
  },
  decision: () => ({
    account: "side",
    tool: "claude",
    targets: [
      { name: "work", color: "teal" },
      { name: "personal", color: "pink" },
    ],
    pctUsed: 94,
    window: "5h",
    resetsIn: "1h 18m",
    sessions: [{ key: "claude/side/s-wedge", title: "Fix wedge on daemon restart", model: "Sonnet 5.5", target: "work", state: "working" }],
    suggestion: "work",
    suggestionWhy: "next in this project's pool",
  }),
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
    return b ? { key, hosted: b.hosted, chatAvailable: b.hosted, view: "terminal", account: { name: b.acct, color: b.color, fiveH: b.five, protect: b.protect }, model: b.model, thinking: b.thinking, contextPct: b.ctx } : null;
  },
  summary: (key) =>
    key.endsWith("s-checkout")
      ? { next: { text: "CI fails on e2e and the branch conflicts with main. One prompt: rebase, then fix e2e (log attached).", action: "Send to agent" }, pr: { number: 311, url: "#", ci: "FAILURE", lifecycle: "OPEN", mergeable: "CONFLICTING", review: "CHANGES_REQUESTED", failingChecks: ["e2e (chromium)"] }, git: { branch: "a11y/checkout", worktree: false, changed: 12, ahead: 5, behind: 9 }, limit: null, more: { id: "claude:personal/7a1c…e02", host: "tmux · as-personal-2", library: "not pinned", children: "1 related session" } }
      : { next: { text: "#142 needs a review; you'll hear when CI is done.", action: "Request review" }, pr: { number: 142, url: "#", ci: "PENDING", lifecycle: "OPEN", mergeable: "MERGEABLE", review: "REVIEW_REQUIRED", failingChecks: [] }, git: { branch: "feat/event-store", worktree: true, changed: 7, ahead: 3, behind: 0 }, limit: null, more: { id: "claude:work/9f2c…e41a", host: "tmux · as-work-3", library: "pinned · in vault", children: "3 subagents" } },
  changes: () => [
    { status: "M", path: "src/engine/ingest.ts", added: 38, removed: 6 },
    { status: "A", path: "src/engine/store.ts", added: 112, removed: 0 },
    { status: "A", path: "src/engine/schema.sql", added: 64, removed: 0 },
    { status: "M", path: "src/engine/projection.ts", added: 21, removed: 4 },
    { status: "A", path: "tests/engine/ingest.test.ts", added: 77, removed: 0 },
  ],
  next: (key) => (key.endsWith("s-checkout") ? { text: "CI fails on e2e and the branch conflicts with main. One prompt: rebase, then fix e2e (log attached).", action: "Send to agent" } : null),
};

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

function App() {
  const def = themeById(THEME);
  const { vars } = resolveTheme(def, ACCENT);
  const slots: V3Slots = {
    body: (key) =>
      BAR[key]?.hosted === false ? (
        <ExternalBody where="Terminal.app · tab 3" facts={<p>as-hook p95 benchmark · ~/code/agent-switch · perf/as-hook</p>} lastLine="as-hook is 6.7× faster at p95 (6.2 ms vs 41.8 ms)." onFocus={() => {}} onTakeOver={() => {}} />
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
  if (q.get("view") === "markdown") {
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
  if (q.get("view") === "claude-settings") {
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
  if (q.get("view") === "hints") {
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
  if (q.get("view") === "tray") {
    const noop = () => {};
    return (
      <AcRoot className="h-full" mode={def.mode} style={vars as CSSProperties}>
        <div className="flex h-full items-start justify-center bg-ac-bg p-5">
          <V3Tray needs={data.needs} away={data.away} sessions={data.sessions} accounts={data.limits} nowMs={data.nowMs} ready appFor={(a) => (a.signIn ? undefined : { name: a.tool === "claude" ? "Claude Desktop" : "Codex Desktop", onOpen: noop })} on={{ verb: noop, moreNeeds: noop, away: noop, session: noop, moreSessions: noop, account: noop, signIn: noop, start: noop, open: noop }} />
        </div>
      </AcRoot>
    );
  }
  return (
    <AcRoot className="h-full" mode={def.mode} style={vars as CSSProperties}>
      <V3Window data={data} slots={slots} act={(a) => console.log("[act]", JSON.stringify(a).slice(0, 200))} />
    </AcRoot>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
