/** The window fixture shared by the reach and design tests: one session, one near-limit account. */
import type { V3Data, V3Slots } from "./window.js";
import { DEFAULT_APPEARANCE } from "./themes/resolve.js";
import type { LimitAccount } from "./limits.js";

export const NOW = Date.UTC(2026, 10, 2, 12);
export const limit: LimitAccount = { key: "claude/work", tool: "claude", name: "work", color: "teal", protect: 98, next: true, signIn: false, checkedMs: NOW, windows: [{ label: "5h", used: 94, resetsAtMs: NOW + 3_600_000, pace: null }] };

export function data(): V3Data {
  return {
    nowMs: NOW,
    health: { state: "down", sinceMs: NOW - 120_000, hostedRunning: 1 },
    needs: [{ id: "l", kind: "limit", subject: "claude/work", who: "work", what: "94% of 5h", verb: "Decide", since: new Date(NOW).toISOString(), version: "1" }],
    away: null,
    history: [{ id: "h", who: "Checkout flow", what: "asked you", doneAt: new Date(NOW - 600_000).toISOString() }],
    sessions: [{ key: "s1", title: "Event store", state: "working", account: { name: "work", nearLimit: true }, branch: "feat/store", pr: null, children: [], needsYou: false }],
    limits: [limit],
    accounts: [{ ...limit, email: "me@example.com", label: null, isDefault: true, running: 1 }],
    table: [],
    library: [],
    vaultBytes: 0,
    autoKeep: true,
    tools: [{ id: "codex", name: "Codex", role: "agent", present: true, version: "0.1", latest: "0.2", healthy: true }],
    palette: [],
    appearance: DEFAULT_APPEARANCE,
    prefersDark: true,
    openIn: { targets: [{ target: "vscode", label: "VS Code", kind: "editor", installed: true }], defaultTarget: "vscode", lastUsed: null, perRepo: {}, focusTerminal: true, agentApps: [{ id: "claude-desktop", label: "Claude Desktop", tool: "claude" }] },
    remote: { remoteControl: ["work"], ssh: false },
    agents: { rows: [{ id: "opencode", name: "OpenCode", binary: "opencode", cls: "acp", enabled: true, version: "2.2.5", local: { runner: "ollama", model: "qwen3-coder:30b" } }], suggestions: [{ id: "goose", name: "Goose", install: ["brew", "install", "block-goose-cli"] }] },
    newSession: {
      initial: { folder: "~/code/x", gitState: null, worktree: false, tool: "claude", model: "Opus", thinking: "High", where: "terminal" },
      facts: { terminalApp: "Terminal.app", hosting: "persistent", thinkingLevels: { claude: ["High"], codex: ["high"], antigravity: ["default"] }, account: { name: "work", color: "teal", reason: "most room", limits: limit, why: ["work has the most room"], paceText: null }, command: "claude", nowMs: NOW },
    },
    decision: () => ({ account: "work", pctUsed: 94, window: "5h", resetsIn: "1h", sessions: [{ key: "s1", title: "Event store", model: "Opus", target: "side" }], suggestion: "side" }),
    bar: () => ({ key: "s1", hosted: true, chatAvailable: false, view: "terminal", account: { name: "work", color: "teal", fiveH: 94, protect: 98 }, model: "Opus", thinking: "high", contextPct: 40 }),
    summary: () => null,
    changes: () => [],
    next: () => null,
  };
}
export const slots: V3Slots = {
  body: () => <p>terminal body</p>,
  usageHistory: <p>usage history view</p>,
  pools: <p>projects and pools view</p>,
  poolCount: 2,
  tools: <p>agent-config card</p>,
  settings: (s) => <p>{`${s} section`}</p>,
};

