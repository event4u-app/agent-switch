import { describe, expect, it, vi } from "vitest";

import type { SessionRow } from "../../transforms.js";
import { emptyViewModel } from "../../vm/load.js";
import type { NeedItem } from "../needs.js";
import { DEFAULT_APPEARANCE } from "../themes/resolve.js";
import type { V3Action } from "../window.js";
import { dispatchV3, githubSlug, menuFor, type DispatchDeps } from "./actions.js";
import { decisionFor } from "./data.js";

const PR = { number: 9, url: "https://github.com/o/r/pull/9", lifecycle: "OPEN", mergeable: "MERGEABLE", review: "NONE", ci: "FAILURE", failingChecks: ["lint"] };
const row = (id: string, over: Partial<SessionRow> = {}): SessionRow => ({ provider: "claude", profile: "work", sessionId: id, projectDir: "-r", cwd: "/r", mtimeMs: 0, live: true, ...over });
const need = (over: Partial<NeedItem>): NeedItem => ({ id: "n", kind: "approval", subject: "claude/work/a", who: "w", what: "x", verb: "v", since: "", version: "", ...over });

function deps(needs: NeedItem[] = [need({ id: "n1" }), need({ id: "n2", kind: "limit", subject: "claude/work" })]) {
  const ipc = {
    focusSessionTerminal: vi.fn(async () => {}),
    needsLater: vi.fn(async () => {}),
    needsSeen: vi.fn(async () => {}),
    hostStart: vi.fn(async () => {}),
    hostEnd: vi.fn(async () => {}),
    hostRespawn: vi.fn(async () => {}),
    setLibraryFlag: vi.fn(async () => {}),
    setAutoKeep: vi.fn(async () => {}),
    setOpenDefault: vi.fn(async () => {}),
    setOpenTerminal: vi.fn(async () => {}),
    setAgentEnabled: vi.fn(async () => {}),
    setRemoteControl: vi.fn(async () => {}),
    setRemoteSsh: vi.fn(async () => {}),
    cleanupMerged: vi.fn(async () => {}),
    engineRestart: vi.fn(async () => {}),
    renameSession: vi.fn(async () => {}),
    openSessionIn: vi.fn(async () => {}),
    openApp: vi.fn(async () => {}),
    continueSession: vi.fn(async () => {}),
    takeoverHosted: vi.fn(async () => {}),
  };
  const rows = new Map<string, SessionRow>([
    ["claude/work/a", row("a", { prs: [PR], git: { toplevel: "/r", branch: "feat/x", headSha: "h", dirty: false, changed: 0, ahead: 1, behind: 0, upstream: "origin/feat/x", remote: "git@github.com:o/r.git", worktree: false, cwd: "/r", cwdSource: "hook" } })],
    ["claude/work/h", row("h", { context: { pct: 1, model: "opus", contextTokens: 1, windowTokens: 2, confidence: "high", source: "transcript" } as never })],
  ]);
  const d = {
    ipc,
    act: { rebind: vi.fn(async () => {}), armRebind: vi.fn(async () => {}), refreshUsage: vi.fn(async () => {}), setDefault: vi.fn(async () => {}) },
    open: vi.fn(),
    toast: vi.fn(),
    openUrl: vi.fn(),
    refresh: vi.fn(),
    rows: () => rows,
    needs: () => needs,
    hosted: (k: string) => k === "claude/work/h",
    setAppearance: vi.fn(),
    setFocusTerminal: vi.fn(),
    prompt: vi.fn(),
  };
  return d satisfies DispatchDeps;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("dispatchV3", () => {
  it("open-in: default, a target, the tool's app on the session's account, the PR, focus", async () => {
    const d = deps();
    await dispatchV3({ type: "open-in", key: "claude/work/a", pick: { kind: "default" } }, d);
    expect(d.ipc.openSessionIn).toHaveBeenLastCalledWith("claude/work/a");
    await dispatchV3({ type: "open-in", key: "claude/work/a", pick: { kind: "target", target: "vscode" } }, d);
    expect(d.ipc.openSessionIn).toHaveBeenLastCalledWith("claude/work/a", "vscode");
    await dispatchV3({ type: "open-in", key: "codex/home/a", pick: { kind: "app", app: "codex-desktop" } }, d);
    expect(d.ipc.openApp).toHaveBeenCalledWith("codex-desktop", "home");
    dispatchV3({ type: "open-in", key: "claude/work/a", pick: { kind: "pr", url: "https://github.com/o/r/pull/9" } }, d);
    expect(d.openUrl).toHaveBeenCalledWith("https://github.com/o/r/pull/9");
    await dispatchV3({ type: "open-in", key: "claude/work/a", pick: { kind: "focus" } }, d);
    expect(d.ipc.focusSessionTerminal).toHaveBeenCalledWith("claude/work/a");
  });

  it("needs: approval focuses the terminal, CI opens the checks, sign-in opens re-auth", async () => {
    const d = deps();
    await dispatchV3({ type: "need", item: need({}) }, d);
    expect(d.ipc.focusSessionTerminal).toHaveBeenCalledWith("claude/work/a");
    dispatchV3({ type: "need", item: need({ kind: "ci" }) }, d);
    expect(d.openUrl).toHaveBeenCalledWith("https://github.com/o/r/pull/9/checks");
    dispatchV3({ type: "need", item: need({ kind: "signin", subject: "claude/home" }) }, d);
    expect(d.open).toHaveBeenCalledWith({ kind: "reauth", accountId: "claude:home" });
  });

  it("later for all, and keep an account dismisses only its limit items", async () => {
    const d = deps();
    await dispatchV3({ type: "needs-later-all" }, d);
    expect(d.ipc.needsLater.mock.calls).toEqual([["n1"], ["n2"]]);
    d.ipc.needsLater.mockClear();
    await dispatchV3({ type: "keep-account", account: "work" }, d);
    expect(d.ipc.needsLater.mock.calls).toEqual([["n2"]]);
    expect(d.refresh).toHaveBeenCalled();
  });

  it("keep an account also puts off its pace suggestion, in the queue and as an answer", async () => {
    const d = { ...deps([need({ id: "n2", kind: "limit", subject: "claude/work" }), need({ id: "p", kind: "pace", subject: "claude/work" })]), requests: () => [{ id: "r-pace", account: "claude/work", state: "open", expiresAt: new Date(Date.now() + 3_600_000).toISOString(), reason: { kind: "pace", window: "seven_day", fill: 60, resetsAt: null }, session: null, rev: 1, raisedBy: "as-daemon", raisedAt: "", candidates: [] }] as never };
    const decide = vi.fn(async () => {});
    (d.ipc as Record<string, unknown>).decideSwitchRequest = decide;
    await dispatchV3({ type: "keep-account", account: "work" }, d);
    expect(d.ipc.needsLater.mock.calls).toEqual([["n2"], ["p"]]);
    expect(decide).toHaveBeenCalledWith("r-pace", "snooze");
  });

  it("start: hosted runs host start, terminal opens the 2.11 start flow", async () => {
    const d = deps();
    const plan = { folder: "/r", gitState: null, worktree: false, tool: "claude" as const, model: "", thinking: "", where: "hosted" as const };
    await dispatchV3({ type: "start", plan }, d);
    expect(d.ipc.hostStart).toHaveBeenCalledWith("claude", "/r");
    dispatchV3({ type: "start", plan: { ...plan, where: "terminal" } }, d);
    expect(d.open).toHaveBeenCalledWith({ kind: "start", cwd: "/r", tool: "claude" });
  });

  it("move: now rebinds, after the turn arms, a brief opens the session sheet", async () => {
    const d = deps();
    await dispatchV3({ type: "move", how: "now", moves: [{ key: "claude/work/a", target: "home" }] }, d);
    expect(d.act.rebind).toHaveBeenCalledWith("claude:a", "claude:home");
    await dispatchV3({ type: "move", how: "after-turn", moves: [{ key: "claude/work/a", target: "home" }] }, d);
    expect(d.act.armRebind).toHaveBeenCalledWith("claude:a", "claude:home");
    await dispatchV3({ type: "move", how: "brief", moves: [{ key: "claude/work/a", target: "home" }] }, d);
    expect(d.open).toHaveBeenCalledWith({ kind: "session", id: "claude:a" });
  });

  it("move: a Claude switch carries on — typed into a hosted window, else the user is told to send one message", async () => {
    const d = deps();
    await dispatchV3({ type: "move", how: "now", moves: [{ key: "claude/work/h", target: "home" }] }, d);
    expect(d.act.rebind).toHaveBeenCalledWith("claude:h", "claude:home");
    expect(d.ipc.continueSession).toHaveBeenCalledWith("claude/work/h");
    await dispatchV3({ type: "move", how: "now", moves: [{ key: "claude/work/a", target: "home" }] }, d);
    expect(d.ipc.continueSession).toHaveBeenCalledTimes(1);
    expect(d.toast).toHaveBeenCalledWith({ tone: "info", text: "Now on home — type one message in its terminal to continue" });
  });

  it("move: a Claude session bound for an account with its own session moves there (takeover) instead of rebinding", async () => {
    const d = { ...deps(), hosted: (k: string) => k === "claude/work/h" };
    await dispatchV3({ type: "move", how: "now", moves: [{ key: "claude/work/h", target: "home", via: "takeover" }] }, d);
    expect(d.ipc.takeoverHosted).toHaveBeenCalledWith("claude/work/h", "home");
    await dispatchV3({ type: "move", how: "after-turn", moves: [{ key: "claude/work/x", target: "home", via: "takeover" }] }, d);
    expect(d.open).toHaveBeenCalledWith({
      kind: "terminal",
      run: { title: "Continue on home", args: ["takeover", "x", "--to", "home", "--provider", "claude", "--stop-source", "--prompt", "Continue where you left off."] },
    });
    expect(d.act.rebind).not.toHaveBeenCalled();
    expect(d.act.armRebind).not.toHaveBeenCalled();
  });

  it("move: several sessions from your own terminals all move — one terminal sheet carries every takeover", async () => {
    const d = { ...deps(), hosted: (k: string) => k === "claude/work/h" };
    await dispatchV3(
      {
        type: "move",
        how: "after-turn",
        moves: [
          { key: "claude/work/x", target: "home", via: "takeover" },
          { key: "claude/work/h", target: "lab", via: "takeover" },
          { key: "claude/work/y", target: "lab", via: "takeover" },
        ],
      },
      d,
    );
    expect(d.ipc.takeoverHosted).toHaveBeenCalledWith("claude/work/h", "lab");
    const args = (id: string, to: string) => ["takeover", id, "--to", to, "--provider", "claude", "--stop-source", "--prompt", "Continue where you left off."];
    expect(d.open).toHaveBeenCalledTimes(1);
    expect(d.open).toHaveBeenCalledWith({ kind: "terminal", run: { title: "Continue on home", args: args("x", "home") }, more: [{ title: "Continue on lab", args: args("y", "lab") }] });
  });

  it("move: Codex moves the session and resumes it with the continuation — in place when hosted, else in the app's terminal", async () => {
    const d = { ...deps(), hosted: (k: string) => k === "codex/work/h" };
    await dispatchV3({ type: "move", how: "now", moves: [{ key: "codex/work/h", target: "home" }] }, d);
    expect(d.ipc.takeoverHosted).toHaveBeenCalledWith("codex/work/h", "home");
    await dispatchV3({ type: "move", how: "after-turn", moves: [{ key: "codex/work/x", target: "home" }] }, d);
    expect(d.open).toHaveBeenCalledWith({
      kind: "terminal",
      run: { title: "Continue on home", args: ["takeover", "x", "--to", "home", "--provider", "codex", "--prompt", "Continue where you left off."] },
    });
    expect(d.act.rebind).not.toHaveBeenCalled();
    expect(d.act.armRebind).not.toHaveBeenCalled();
  });

  it("session menu: rename asks, pin pins, End asks first and only then ends", async () => {
    const d = deps();
    dispatchV3({ type: "session-menu", key: "claude/work/h", item: "Rename…" }, d);
    d.prompt.mock.calls[0][0].onSubmit("new name");
    await flush();
    expect(d.ipc.renameSession).toHaveBeenCalledWith("claude/work/h", "new name");
    await dispatchV3({ type: "session-menu", key: "claude/work/h", item: "Pin" }, d);
    expect(d.ipc.setLibraryFlag).toHaveBeenCalledWith("claude/work/h", "pin", true);
    dispatchV3({ type: "session-menu", key: "claude/work/h", item: "End…" }, d);
    expect(d.ipc.hostEnd).not.toHaveBeenCalled();
    d.open.mock.calls.at(-1)![0].onConfirm();
    await flush();
    expect(d.ipc.hostEnd).toHaveBeenCalledWith("claude/work/h");
    dispatchV3({ type: "session-menu", key: "claude/work/h", item: "Compact" }, d);
    expect(d.open).toHaveBeenLastCalledWith({ kind: "terminal", run: { args: ["compact", "claude/work/h"], title: "Compact" } });
  });

  it("batch End ends only hosted sessions, after asking", async () => {
    const d = deps();
    dispatchV3({ type: "batch", op: "onEnd", keys: ["claude/work/a", "claude/work/h"] }, d);
    d.open.mock.calls[0][0].onConfirm();
    await flush();
    expect(d.ipc.hostEnd.mock.calls).toEqual([["claude/work/h"]]);
    const e = deps();
    dispatchV3({ type: "batch", op: "onEnd", keys: ["claude/work/a"] }, e);
    expect(e.open).not.toHaveBeenCalled();
    expect(e.toast).toHaveBeenCalled();
  });

  it("the view switch goes to the window's switch", () => {
    const d = { ...deps(), switchView: vi.fn() };
    dispatchV3({ type: "view", key: "claude/work/h", view: "chat" }, d);
    expect(d.switchView).toHaveBeenCalledWith("claude/work/h", "chat");
  });

  it("model and thinking respawn a hosted session; nothing for a session not hosted", async () => {
    const d = deps();
    await dispatchV3({ type: "set-model", key: "claude/work/a", model: "sonnet" }, d);
    await dispatchV3({ type: "set-thinking", key: "claude/work/a", level: "high" }, d);
    expect(d.ipc.hostRespawn).not.toHaveBeenCalled();
    await dispatchV3({ type: "set-thinking", key: "claude/work/h", level: "high" }, d);
    expect(d.ipc.hostRespawn).toHaveBeenCalledWith("claude/work/h", { effort: "high" });
    await dispatchV3({ type: "set-model", key: "claude/work/h", model: "sonnet" }, d);
    expect(d.ipc.hostRespawn).toHaveBeenLastCalledWith("claude/work/h", { model: "sonnet" });
  });

  it("blocker: a waiting session focuses its terminal first", async () => {
    const d = deps();
    await dispatchV3({ type: "blocker", key: "claude/work/a" }, d);
    expect(d.ipc.focusSessionTerminal).toHaveBeenCalledWith("claude/work/a");
    expect(d.openUrl).not.toHaveBeenCalled();
  });

  it("blocker and PR actions open the right page", () => {
    const d = deps([]);
    dispatchV3({ type: "blocker", key: "claude/work/a" }, d);
    expect(d.openUrl).toHaveBeenLastCalledWith("https://github.com/o/r/pull/9/checks");
    dispatchV3({ type: "open-pr", key: "claude/work/a" }, d);
    expect(d.openUrl).toHaveBeenLastCalledWith("https://github.com/o/r/pull/9");
    dispatchV3({ type: "create-pr", key: "claude/work/a" }, d);
    expect(d.openUrl).toHaveBeenLastCalledWith("https://github.com/o/r/compare/feat%2Fx?expand=1");
    dispatchV3({ type: "create-pr", key: "claude/work/h" }, d);
    expect(d.toast).toHaveBeenCalled();
  });

  it("accounts, library, settings, engine", async () => {
    const d = deps();
    dispatchV3({ type: "account", op: "add" }, d);
    expect(d.open).toHaveBeenLastCalledWith({ kind: "add-account" });
    await dispatchV3({ type: "account", op: "use", key: "claude:home" }, d);
    expect(d.act.setDefault).toHaveBeenCalledWith("claude:home");
    dispatchV3({ type: "account", op: "more", key: "claude:home" }, d);
    expect(d.open).toHaveBeenLastCalledWith({ kind: "account", id: "claude:home" });
    dispatchV3({ type: "account", op: "terminal", key: "codex:cx" }, d);
    expect(d.open.mock.calls.at(-1)![0]).toMatchObject({ kind: "terminal", run: { title: "cx" } });
    await dispatchV3({ type: "library", op: "archive", key: "k", value: true }, d);
    expect(d.ipc.setLibraryFlag).toHaveBeenLastCalledWith("k", "archive", true);
    await dispatchV3({ type: "library", op: "auto-keep", value: false }, d);
    expect(d.ipc.setAutoKeep).toHaveBeenCalledWith(false);
    dispatchV3({ type: "library", op: "resume", key: "k" }, d);
    expect(d.open).toHaveBeenLastCalledWith({ kind: "terminal", run: { args: ["sessions", "resume", "k", "--yes"], title: "Resume" } });
    dispatchV3({ type: "appearance", value: DEFAULT_APPEARANCE }, d);
    expect(d.setAppearance).toHaveBeenCalledWith(DEFAULT_APPEARANCE);
    await dispatchV3({ type: "open-default", target: "finder", repo: "/r" }, d);
    expect(d.ipc.setOpenDefault).toHaveBeenCalledWith("finder", "/r");
    await dispatchV3({ type: "open-terminal", id: "iterm" }, d);
    expect(d.ipc.setOpenTerminal).toHaveBeenCalledWith("iterm");
    dispatchV3({ type: "focus-terminal-setting", value: false }, d);
    expect(d.setFocusTerminal).toHaveBeenCalledWith(false);
    await dispatchV3({ type: "restart-engine" }, d);
    expect(d.ipc.engineRestart).toHaveBeenCalled();
  });

  it("a chat's approval opens the chat; the palette starts a new chat", () => {
    const d = deps();
    const openTab = vi.fn();
    const newChat = vi.fn();
    dispatchV3({ type: "need", item: need({ verb: "Open chat", subject: "claude/work/h" }) }, { ...d, openTab, newChat });
    expect(openTab).toHaveBeenCalledWith("claude/work/h");
    expect(d.ipc.focusSessionTerminal).not.toHaveBeenCalled();
    dispatchV3({ type: "palette", entry: { id: "chat:new", group: "commands", title: "New session in chat view" }, newTab: false }, { ...d, openTab, newChat });
    expect(newChat).toHaveBeenCalled();
  });

  it("in a chat, the model changes through its bridge; thinking says where to change it", () => {
    const d = deps();
    const setModel = vi.fn();
    const chatOf = (k: string) => (k === "claude/work/a" ? { setModel } : null);
    dispatchV3({ type: "set-model", key: "claude/work/a", model: "sonnet" }, { ...d, chatOf });
    expect(setModel).toHaveBeenCalledWith("sonnet");
    expect(d.ipc.hostRespawn).not.toHaveBeenCalled();
    dispatchV3({ type: "set-thinking", key: "claude/work/a", level: "high" }, { ...d, chatOf });
    expect(d.toast).toHaveBeenCalledWith({ tone: "info", text: expect.stringMatching(/terminal view/) });
  });

  it("clicking the away summary marks it seen, then reads again", async () => {
    const d = deps();
    await dispatchV3({ type: "away" }, d);
    expect(d.ipc.needsSeen).toHaveBeenCalledTimes(1);
    expect(d.refresh).toHaveBeenCalled();
  });

  it("a failing CLI call becomes an alert toast, never a throw", async () => {
    const d = deps();
    d.ipc.engineRestart.mockRejectedValueOnce(new Error("service down"));
    await dispatchV3({ type: "restart-engine" }, d);
    expect(d.toast).toHaveBeenCalledWith({ tone: "alert", text: "Engine restart failed: service down" });
    expect(d.refresh).not.toHaveBeenCalled();
  });

  it("every action type is handled without throwing", () => {
    const all: V3Action[] = [
      { type: "need-more" }, { type: "away" }, { type: "choose-account" }, { type: "clean-up" }, { type: "view", key: "k", view: "chat" },
      { type: "review", key: "k" }, { type: "commit", key: "k" }, { type: "palette", entry: { id: "x", group: "commands", title: "x" }, newTab: false },
      { type: "batch", op: "onPin", keys: ["k"] }, { type: "batch", op: "onArchive", keys: ["k"] }, { type: "batch", op: "onClean", keys: [] },
      { type: "account", op: "refresh" }, { type: "account", op: "sign-in", key: "claude:x" },
    ];
    for (const a of all) expect(() => dispatchV3(a, deps())).not.toThrow();
  });
});

describe("menuFor", () => {
  it("Detach never; End and Compact only when hosted; moves not for Antigravity", () => {
    expect(menuFor(row("a"), false)).toEqual(["Rename…", "Pin", "Move to another account…", "Take over here…", "Hand off…"]);
    expect(menuFor(row("a"), true)).toEqual(["Rename…", "Pin", "Move to another account…", "Take over here…", "Hand off…", "Compact", "End…"]);
    expect(menuFor(row("a", { provider: "antigravity" }), true)).toEqual(["Rename…", "Pin", "Compact", "End…"]);
  });
});

describe("decisionFor a single session", () => {
  it("moves only that session", () => {
    const vm = { ...emptyViewModel(0), accounts: [{ id: "claude:work", tool: "claude", name: "work", windows: [{ key: "five_hour", label: "5h", utilization: 50, resetsAt: null }], state: "ready" }, { id: "claude:home", tool: "claude", name: "home", windows: [], state: "ready" }] as never };
    const d = decisionFor("claude/work/a", vm, [row("a"), row("b")], 0)!;
    expect(d.sessions.map((s) => s.key)).toEqual(["claude/work/a"]);
  });
});

describe("githubSlug", () => {
  it.each([
    ["git@github.com:o/r.git", "o/r"],
    ["https://github.com/o/r", "o/r"],
    ["https://github.com/o/r.js.git", "o/r.js"],
    ["https://gitlab.com/o/r", null],
    [null, null],
  ])("%s → %s", (r, s) => expect(githubSlug(r)).toBe(s));
});

import tauriConf from "../../../src-tauri/tauri.conf.json?raw";

// The scope was the GitHub-only list until the owner opened it to any http(s)
// URL (2026-11-05, ⌘-click on chat links); what it still refuses is checked here.
describe("the shell open scope admits the PR pages the adapter opens, and no other scheme", () => {
  const scope = new RegExp(`^(?:${JSON.parse(tauriConf).plugins.shell.open})$`);
  it.each(["https://github.com/o/r/pull/9", "https://github.com/o/r/pull/9/checks", `https://github.com/o/r/compare/${encodeURIComponent("feat/x")}?expand=1`])("allows %s", (u) => expect(scope.test(u)).toBe(true));
  it.each(["javascript:alert(1)", "file:///etc/passwd", "github.com/o/r/pull/9", "agent-switch://pull/9", "https://github.com/o/r/pull/9 x", "https://github.com/o/r/pull/9\n"])("refuses %s", (u) => expect(scope.test(u)).toBe(false));
});
