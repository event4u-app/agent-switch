import { describe, expect, it, vi } from "vitest";

import type { SessionRow } from "../../transforms.js";
import { emptyViewModel } from "../../vm/load.js";
import type { Account, ViewModel } from "../../vm/types.js";
import { DEFAULT_APPEARANCE } from "../themes/resolve.js";
import { childrenOf, decisionFor, doneToday, nextStep, sessionKey, startCommand, toV3Data, windowLabel, worktreeOf, type AdapterEnv } from "./data.js";
import { emptyFeeds, type V3Feeds } from "./useFeeds.js";

const NOW = Date.parse("2026-11-03T15:00:00");

function account(name: string, over: Partial<Account> = {}): Account {
  return {
    id: `claude:${name}`,
    tool: "claude",
    name,
    identity: `${name}@example.com`,
    plan: "max",
    label: null,
    color: "blue",
    isDefault: false,
    state: "ready",
    windows: [{ key: "five_hour", label: "5h", utilization: 40, resetsAt: new Date(NOW + 90 * 60_000).toISOString() }],
    checkedAt: NOW - 1000,
    resetCredits: null,
    threshold: 90,
    protection: null,
    auth: null,
    surfaces: [],
    liveSessions: 0,
    pools: [],
    ...over,
  };
}

function row(id: string, over: Partial<SessionRow> = {}): SessionRow {
  return { provider: "claude", profile: "work", sessionId: id, projectDir: "-r", cwd: "/r/app", mtimeMs: NOW - 60_000, live: true, summary: `task ${id}`, ...over };
}

function env(over: Partial<AdapterEnv> = {}): AdapterEnv {
  return {
    now: NOW,
    appearance: DEFAULT_APPEARANCE,
    prefersDark: true,
    focusTerminal: true,
    engineDownSince: null,
    plan: { folder: "/r/app", gitState: null, worktree: false, tool: "claude", model: "opus", thinking: "high", where: "hosted" },
    terminalApp: "Terminal.app",
    changes: new Map(),
    wantChanges: () => {},
    ...over,
  };
}

function vmWith(accounts: Account[], rows: SessionRow[]): ViewModel {
  return { ...emptyViewModel(NOW), accounts, sessionRows: rows };
}

describe("toV3Data", () => {
  it("with no reads at all: the documented empty state, nothing throws", () => {
    const d = toV3Data(emptyViewModel(NOW), emptyFeeds(), env());
    expect(d.health).toEqual({ state: "ready" });
    expect([d.needs, d.history, d.sessions, d.limits, d.accounts, d.table, d.library, d.openIn.targets]).toEqual([[], [], [], [], [], [], [], []]);
    // Only the command that starts a chat.
    expect(d.palette.map((p) => p.id)).toEqual(["chat:new"]);
    expect(d.away).toBeNull();
    expect(d.autoKeep).toBe(true);
    expect(d.bar("claude/x/y")).toBeNull();
    expect(d.summary("claude/x/y")).toBeNull();
    expect(d.next("claude/x/y")).toBeNull();
    expect(d.decision("claude/x")).toBeNull();
  });

  it("property: every listed session resolves in bar and summary; no account twice in the strip; table covers every row", () => {
    // Deterministic pseudo-random rows (LCG), so a failure reproduces.
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const names = ["work", "home", "lab"];
    const rows: SessionRow[] = Array.from({ length: 60 }, (_, i) =>
      row(`s${i}`, {
        profile: names[Math.floor(rnd() * 3)],
        live: rnd() > 0.4,
        mtimeMs: NOW - Math.floor(rnd() * 3 * 86_400_000),
        summary: rnd() > 0.2 ? `t${i}` : null,
        cwd: rnd() > 0.1 ? `/r/p${i}` : null,
        ...(rnd() > 0.8 && i > 0 ? { parent: `claude/work/s${i - 1}` } : {}),
      }),
    );
    const accounts = names.map((n, i) => account(n, { isDefault: i === 0 }));
    const d = toV3Data(vmWith([...accounts, accounts[0]], rows), emptyFeeds(), env());
    for (const s of d.sessions) {
      expect(d.bar(s.key)?.key).toBe(s.key);
      expect(d.summary(s.key)).not.toBeNull();
      expect(s.title.length).toBeGreaterThan(0);
    }
    expect(d.limits.map((l) => l.key).sort()).toEqual(names.map((n) => `claude:${n}`).sort());
    expect(d.accounts).toHaveLength(names.length);
    expect(d.table.map((t) => t.key).sort()).toEqual(rows.map(sessionKey).sort());
    // The sessions zone: roots only, live or finished today.
    const startOfToday = new Date(NOW).setHours(0, 0, 0, 0);
    expect(d.sessions.every((s) => {
      const r = rows.find((x) => sessionKey(x) === s.key)!;
      return !r.parent && (r.live || r.mtimeMs >= startOfToday) && (s.doneToday === true) === !r.live;
    })).toBe(true);
  });

  it("joins needs, hosting, PR and account into a row", () => {
    const r = row("a1", { prs: [{ number: 12, url: "https://github.com/o/r/pull/12", lifecycle: "OPEN", mergeable: "MERGEABLE", review: "NONE", ci: "FAILURE", failingChecks: ["lint"] }], context: { pct: 41, model: "opus", contextTokens: 1, windowTokens: 2, confidence: "high", source: "transcript", effort: "high" } as never });
    const feeds: V3Feeds = {
      ...emptyFeeds(),
      needs: { items: [{ id: "n1", kind: "approval", subject: "claude/work/a1", who: "w", what: "x", verb: "Focus terminal", since: "", version: "" }], away: null, history: [] },
      host: { mode: "persistent", hosted: [{ key: "claude/work/a1", provider: "claude", account: "work", sessionId: "a1", cwd: "/r", startedAt: "", alive: true }] },
    };
    const d = toV3Data(vmWith([account("work", { state: "near-limit" })], [r]), feeds, env());
    expect(d.sessions[0]).toMatchObject({ key: "claude/work/a1", needsYou: true, pr: { number: 12, ci: "FAILURE" }, account: { name: "work", nearLimit: true } });
    expect(d.bar("claude/work/a1")).toMatchObject({ hosted: true, model: "Opus", modelId: "opus", thinking: "high", contextPct: 41, account: { fiveH: 40, protect: 90 } });
    const s = d.summary("claude/work/a1")!;
    expect(s.next).toEqual({ text: "Waits for you in its terminal", action: "Focus terminal" });
    expect(s.pr?.failingChecks).toEqual(["lint"]);
    expect(s.limit).toContain("40%");
    expect(s.more.host).toBe("Hosted by Agent Switch");
  });

  it("a hosted session without a transcript yet still gets a row, once", () => {
    const h = (id: string) => ({ key: `claude/work/${id}`, provider: "claude", account: "work", sessionId: id, cwd: "/r/new", startedAt: new Date(NOW - 5000).toISOString(), alive: true });
    const feeds = { ...emptyFeeds(), host: { mode: "persistent" as const, hosted: [h("fresh"), h("a1"), { ...h("gone"), alive: false }] } };
    const d = toV3Data(vmWith([], [row("a1")]), feeds, env());
    expect(d.sessions.map((s) => [s.key, s.title])).toEqual([["claude/work/a1", "task a1"], ["claude/work/fresh", "new"]]);
    expect(d.bar("claude/work/fresh")?.hosted).toBe(true);
  });

  it("codex rows from the feed join the table and the palette", () => {
    const feeds = { ...emptyFeeds(), codexRows: [row("c1", { provider: "codex", profile: "cx" })] };
    const d = toV3Data(vmWith([], [row("a1")]), feeds, env());
    expect(d.table.map((t) => [t.key, t.tool])).toEqual([["claude/work/a1", "claude"], ["codex/cx/c1", "codex"]]);
    expect(d.palette.filter((p) => p.group === "sessions")).toHaveLength(2);
  });

  it("engine down: since when it was first seen down, with the hosted count", () => {
    const feeds = { ...emptyFeeds(), engine: { running: false, reason: "x", hostedRunning: 3 } };
    expect(toV3Data(emptyViewModel(NOW), feeds, env({ engineDownSince: NOW - 5000 })).health).toEqual({ state: "down", sinceMs: NOW - 5000, hostedRunning: 3 });
  });

  it("library rows: kept states map onto the vault cell", () => {
    const feeds: V3Feeds = {
      ...emptyFeeds(),
      library: {
        autoKeep: false,
        vaultBytes: 9,
        entries: [
          { key: "claude/work/k", name: null, tags: [], pinned: true, archived: false, autoKept: false, summary: "sum", cwd: "/r/proj", branch: "b", pr: null, lastMs: 1, kept: { state: "kept", bytes: 9 }, canResume: true },
          { key: "claude/work/r", name: "named", tags: ["t"], pinned: false, archived: false, autoKept: true, summary: null, cwd: null, branch: null, pr: null, lastMs: 2, kept: { state: "at-risk", daysLeft: 3 }, canResume: true },
          { key: "claude/work/l", name: null, tags: [], pinned: true, archived: true, autoKept: false, summary: null, cwd: null, branch: null, pr: null, lastMs: 3, kept: { state: "lost" }, canResume: false },
        ],
      },
    };
    const d = toV3Data(emptyViewModel(NOW), feeds, env());
    expect(d.library.map((l) => [l.name, l.project, l.vault, l.transcript])).toEqual([
      ["sum", "proj", { state: "saved", bytes: 9 }, true],
      ["named", null, { state: "none", cleanupInDays: 3 }, true],
      ["l", null, { state: "unavailable" }, false],
    ]);
    expect([d.vaultBytes, d.autoKeep]).toEqual([9, false]);
  });

  it("changes: asks for the read and returns what is cached", () => {
    const want = vi.fn();
    const d = toV3Data(emptyViewModel(NOW), emptyFeeds(), env({ wantChanges: want, changes: new Map([["k", [{ status: "M", path: "a", added: 1, removed: 0 }]]]) }));
    expect(d.changes("k")).toHaveLength(1);
    expect(d.changes("other")).toEqual([]);
    expect(want.mock.calls).toEqual([["k"], ["other"]]);
  });

  it("Open-in: agent apps never reach the settings list", () => {
    const feeds = { ...emptyFeeds(), openTargets: { default: "vscode", perRepo: { "/r": "finder" }, lastUsed: "finder", targets: [{ target: "vscode", label: "VS Code", kind: "editor" as const, installed: true }] } };
    const d = toV3Data(emptyViewModel(NOW), feeds, env({ focusTerminal: false }));
    expect(d.openIn).toEqual({ targets: [{ target: "vscode", label: "VS Code", kind: "editor", installed: true }], defaultTarget: "vscode", lastUsed: "finder", perRepo: { "/r": "finder" }, focusTerminal: false, agentApps: [] });
    expect(d.openIn.targets.some((t) => t.kind === "agent-app")).toBe(false);
  });
});

describe("pieces", () => {
  it("doneToday: only since local midnight, newest first; empty stays empty", () => {
    const at = (h: number) => new Date(new Date(NOW).setHours(h, 0, 0, 0)).toISOString();
    const yesterday = new Date(NOW - 86_400_000).toISOString();
    const h = [
      { id: "1", kind: "ci", who: "a", what: "x", doneAt: at(9) },
      { id: "2", kind: "ci", who: "b", what: "y", doneAt: yesterday },
      { id: "3", kind: "ci", who: "c", what: "z", doneAt: at(14) },
      { id: "4", kind: "ci", who: "d", what: "w", doneAt: "not a date" },
    ];
    expect(doneToday(h, NOW).map((x) => x.id)).toEqual(["3", "1"]);
    expect(doneToday([], NOW)).toEqual([]);
  });

  it("windowLabel", () => {
    expect([windowLabel("five_hour", "5h"), windowLabel("seven_day", "All"), windowLabel("weekly_opus", "Opus"), windowLabel("monthly", "30d"), windowLabel("x", "y")]).toEqual(["5h", "week", "week · Opus", "30d", "y"]);
  });

  it("childrenOf: hook subagents, named helpers, and the rest by count", () => {
    const kids = childrenOf(row("p", { children: [{ kind: "subagent", agentId: "a1", type: "Explore", state: "running", source: "hook" }, { kind: "council", sessionKey: "claude/work/h", label: "council", state: "done", source: "lineage" }], childCount: 5 }));
    expect(kids.map((k) => [k.id, k.label, k.state, k.source, k.count])).toEqual([
      ["a1", "Explore", "working", "hook", undefined],
      ["claude/work/h", "council", "done", "lineage", undefined],
      ["claude/work/p#counted", "subagents", "done", "counted", 3],
    ]);
  });

  it("nextStep: failing CI, conflict, changes requested, unpushed work, nothing", () => {
    const pr = (o: object) => row("x", { prs: [{ number: 4, url: "u", lifecycle: "OPEN", mergeable: "MERGEABLE", review: "NONE", ci: "SUCCESS", failingChecks: [], ...o }] });
    expect(nextStep(pr({ ci: "FAILURE", failingChecks: ["test"] }), false)?.does).toBe("open-checks");
    expect(nextStep(pr({ mergeable: "CONFLICTING" }), false)?.does).toBe("open-pr");
    expect(nextStep(pr({ review: "CHANGES_REQUESTED" }), false)?.does).toBe("open-pr");
    expect(nextStep(pr({}), false)).toBeNull();
    const git = { toplevel: "/r", branch: "feat", headSha: "a", dirty: false, changed: 0, ahead: 2, behind: 0, upstream: "origin/feat", remote: "git@github.com:o/r.git", worktree: false, cwd: "/r", cwdSource: "hook" as const };
    expect(nextStep(row("y", { git }), false)).toEqual({ text: "2 commits on feat without a PR", action: "Create PR", does: "create-pr" });
    expect(nextStep(row("y", { git: { ...git, ahead: 0 } }), false)).toBeNull();
    expect(nextStep(row("y"), true)?.does).toBe("focus");
  });

  it("decisionFor: the account's live sessions, moved to the least-used other account", () => {
    const vm = vmWith([account("work", { windows: [{ key: "five_hour", label: "5h", utilization: 93, resetsAt: new Date(NOW + 125 * 60_000).toISOString() }] }), account("home", { windows: [{ key: "five_hour", label: "5h", utilization: 10, resetsAt: null }] }), account("lab")], []);
    const d = decisionFor("claude/work", vm, [row("a"), row("b", { live: false }), row("c", { profile: "home" })], NOW)!;
    expect(d).toMatchObject({ account: "work", pctUsed: 93, window: "5h", resetsIn: "2 h 5 min", suggestion: "home" });
    expect(d.sessions.map((s) => [s.key, s.target])).toEqual([["claude/work/a", "home"]]);
    expect(decisionFor("claude/none", vm, [], NOW)).toBeNull();
  });

  it("decisionFor spreads the sessions: the heaviest one gets the account with the most room", () => {
    const w = (five: number, week: number) => [
      { key: "five_hour", label: "5h", utilization: five, resetsAt: null },
      { key: "seven_day", label: "Week", utilization: week, resetsAt: null },
    ];
    const vm = vmWith([account("work", { windows: w(90, 40) }), account("roomy", { windows: w(0, 10) }), account("mid", { windows: w(30, 20) }), account("tight", { windows: w(5, 85) })], []);
    const ctx = (model: string, pct: number) => ({ model, pct }) as SessionRow["context"];
    const rows = [row("small", { context: ctx("claude-haiku-4", 5) }), row("big", { context: ctx("claude-opus-5-5", 80), childCount: 2 }), row("medium", { context: ctx("claude-sonnet-5-5", 40) })];
    const d = decisionFor("claude/work", vm, rows, NOW)!;
    const to = Object.fromEntries(d.sessions.map((s) => [s.key.split("/")[2], s.target]));
    // "tight" has the freest 5h window but its week is nearly spent: the week counts too.
    // Once "roomy" carries the big session, "mid" has more left for the next ones.
    expect(to).toEqual({ big: "roomy", medium: "mid", small: "mid" });
    expect(d.suggestion).toBe("roomy");
  });

  it("decisionFor puts a second heavy session elsewhere once the emptiest account has taken one", () => {
    const vm = vmWith([account("work", { windows: [{ key: "five_hour", label: "5h", utilization: 90, resetsAt: null }] }), account("a", { windows: [{ key: "five_hour", label: "5h", utilization: 0, resetsAt: null }] }), account("b", { windows: [{ key: "five_hour", label: "5h", utilization: 10, resetsAt: null }] })], []);
    const heavy = { context: { model: "claude-opus-5-5", pct: 70 } as SessionRow["context"] };
    const d = decisionFor("claude/work", vm, [row("x", heavy), row("y", heavy)], NOW)!;
    expect(d.sessions.map((s) => s.target).sort()).toEqual(["a", "b"]);
  });

  it("startCommand quotes what needs it", () => {
    const p = { folder: "/r/my app", gitState: null, worktree: false, tool: "claude" as const, model: "", thinking: "", where: "hosted" as const };
    expect(startCommand(p, "work")).toBe("agent-switch host start work --provider claude --cwd '/r/my app'");
    expect(startCommand({ ...p, where: "terminal", tool: "codex", folder: "/r" }, null)).toBe("agent-switch run --provider codex --cwd /r");
  });
});

describe("start dialog routing", () => {
  it("takes the account and reasons from `dir --json`, the default account until it is read", () => {
    const vm = vmWith([account("work", { isDefault: true }), account("side")], []);
    const before = toV3Data(vm, emptyFeeds(), env()).newSession.facts.account;
    expect([before.name, before.why]).toEqual(["work", []]);
    const after = toV3Data(vm, emptyFeeds(), env({ route: { profile: "claude/side", why: ["folder rule ~/r → side", "side has the most room"] } })).newSession.facts.account;
    expect([after.name, after.reason, after.why]).toEqual(["side", "folder rule ~/r → side", ["folder rule ~/r → side", "side has the most room"]]);
    expect(toV3Data(vm, emptyFeeds(), env({ route: { profile: "claude/work", why: [], blocked: "no account may start here" } })).newSession.facts.account.reason).toBe("no account may start here");
    const unknown = toV3Data(vm, emptyFeeds(), env({ route: { profile: "claude/gone", why: ["gone has room"] } })).newSession.facts.account;
    expect([unknown.name, unknown.why]).toEqual(["work", []]);
  });
});

describe("worktreeOf", () => {
  it("names a subagent's worktree from its hook record, and only that", () => {
    const r = row("p", { children: [{ kind: "subagent", agentId: "a1", cwd: "/r/.claude/worktrees/agent-a1" }, { kind: "subagent", agentId: "a2", cwd: "/r" }, { kind: "helper", sessionKey: "k" }] });
    const of = worktreeOf(r);
    expect([of("a1"), of("a2"), of("nope")]).toEqual(["agent-a1", null, null]);
    expect(worktreeOf(undefined)("a1")).toBeNull();
  });

  it("model choices: Claude's aliases with the running one checked; Codex only its reasoning levels", () => {
    const rows = [row("a", { context: { pct: 1, model: "claude-opus-4-7", effort: "high" } as never }), row("c", { provider: "codex" as never })];
    const d = toV3Data(vmWith([], rows), emptyFeeds(), env({ chats: new Set(["claude/work/a"]) }));
    const a = d.models!("claude/work/a")!;
    expect(a.models.map((m) => m.id)).toEqual(["opus", "sonnet", "haiku"]);
    expect([a.current, a.currentThinking]).toEqual(["opus", "high"]);
    expect(a.thinkingWhy).toMatch(/chat starts/);
    const c = d.models!("codex/work/c")!;
    expect(c.models).toEqual([]);
    expect(c.thinking).toEqual(["minimal", "low", "medium", "high"]);
    expect(d.models!("nope")).toBeNull();
  });

  it("Open-in: the agent apps are the installed desktop apps of a tool", () => {
    const vm = { ...emptyViewModel(NOW), surfaces: [
      { id: "claude-desktop", tool: "claude", name: "Claude Desktop", kind: "desktop", detected: true },
      { id: "codex-desktop", tool: "codex", name: "Codex", kind: "desktop", detected: false },
      { id: "codex-ide", tool: "codex", name: "Codex IDE", kind: "desktop", detected: true },
    ] as never };
    expect(toV3Data(vm, emptyFeeds(), env()).openIn.agentApps).toEqual([{ id: "claude-desktop", label: "Claude Desktop", tool: "claude" }]);
  });
});
