/**
 * Roadmap 7.7 (arena r1, 02-sessions and 04-subagents): the list says each
 * row's age, tool and account; status first by default; one time format; CI in
 * words in the table; the state dots tell waiting, idle and recent apart.
 * Subagents carry their task, Children rows open, and a subagent opens
 * read-only with its current tool and how long it ran.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { SessionRow, SessionsZone, childNoun, type ChildModel, type RowSession } from "./sessions.js";
import { SessionStateIcon } from "../ui/SessionStateIcon.js";
import { ago } from "./kit.js";
import { AllSessionsPage, type TableSession } from "./pages.js";
import { ChildrenWindow } from "./panels.js";
import { rightItems } from "./frame.js";
import { BOARDS } from "./design-fixture/embed.js";
import { V3Window, type V3Data } from "./window.js";
import { NOW, data, slots } from "./window-fixture.js";
import { childrenOf, toV3Data, worktreeOf } from "./adapter/data.js";
import { emptyViewModel } from "../vm/load.js";
import { emptyFeeds } from "./adapter/useFeeds.js";
import { DEFAULT_APPEARANCE } from "./themes/resolve.js";
import type { SessionRow as CliRow } from "../transforms.js";
import { SubagentTranscript } from "./adapter/slots.js";

afterEach(cleanup);

const MIN = 60_000;
const s = (key: string, over: Partial<RowSession> = {}): RowSession => ({ key, title: `title ${key}`, state: "idle", account: { name: "work", nearLimit: false }, branch: "main", pr: null, children: [], needsYou: false, ...over });
const batch = { onClear: vi.fn(), onPin: vi.fn(), onArchive: vi.fn(), onClean: vi.fn(), onEnd: vi.fn() };
const zone = (sessions: RowSession[], extra: Partial<Parameters<typeof SessionsZone>[0]> = {}) => (
  <SessionsZone sessions={sessions} activeKey={null} selection={null} openKeys={new Set()} onSelect={vi.fn()} onToggleChildren={vi.fn()} onCheck={vi.fn()} onCleanUp={vi.fn()} onDoneToday={vi.fn()} batch={batch} {...extra} />
);
const sub = (id: string, over: Partial<ChildModel> = {}): ChildModel => ({ id, label: "general-purpose · migrate JSON stores", kind: "subagent", state: "working", source: "hook", tool: "claude", account: { name: "work", color: "teal" }, ...over });

describe("one time format (spec §3.6)", () => {
  it("ago: now under a minute, else the duration and 'ago'", () => {
    expect(ago(20_000)).toBe("now");
    expect(ago(21 * MIN)).toBe("21m ago");
    expect(ago(78 * MIN)).toBe("1h 18m ago");
  });
});

describe("a session row says its age, tool and account (02 F1, F3, F4)", () => {
  it("comfortable: tool monogram before the title, account colour mark and the age on the second line", () => {
    const row = s("codex/work/h", { tool: "codex", account: { name: "work", nearLimit: false, color: "teal" }, lastActiveMs: NOW - 21 * MIN });
    const { container } = render(zone([row], { comfortable: true, nowMs: NOW }));
    expect(screen.getByText("Cx")).toBeTruthy();
    expect(container.querySelector("[data-account-mark]")).toBeTruthy();
    expect(screen.getByText("21m ago")).toBeTruthy();
  });

  it("a Claude row carries its own monogram, so the two tools never look alike", () => {
    render(zone([s("claude/work/a", { tool: "claude" })], { comfortable: true, nowMs: NOW }));
    expect(screen.getByText("C")).toBeTruthy();
  });

  it("compact: the age stays on the row when the trailing slot is free", () => {
    render(zone([s("a", { lastActiveMs: NOW - 5 * MIN })], { nowMs: NOW }));
    expect(screen.getByText("5m ago")).toBeTruthy();
  });
});

describe("status first by default (spec §5.2, 02 F2)", () => {
  it("without a chosen order: needs you, working, the rest — newest first inside each", () => {
    const at: Record<string, number> = { old: NOW - 40 * MIN, fresh: NOW - MIN, w: NOW - 10 * MIN, w2: NOW - 2 * MIN, i: NOW };
    const rows = [s("fresh"), s("w", { state: "working" }), s("old", { needsYou: true }), s("w2", { state: "working" }), s("i")];
    const { container } = render(zone(rows, { lastActiveOf: (k) => at[k] ?? null }));
    const titles = [...container.querySelectorAll("[role=button] .truncate.text-\\[13px\\]")].map((e) => e.textContent);
    expect(titles).toEqual(["title old", "title w2", "title w", "title i", "title fresh"]);
  });

  it("the list's head names the default order", () => {
    render(zone([s("a")], { onView: vi.fn() }));
    expect(screen.getByTitle("Sort and group").textContent).toMatch(/^Status/);
  });
});

describe("the state dot (02 F6)", () => {
  it("waiting, idle and recent draw three different marks, and every dot has a tooltip", () => {
    const shapes = (["waiting", "idle", "recent"] as const).map((st) => {
      const { container } = render(<SessionStateIcon state={st} />);
      const el = container.firstElementChild as HTMLElement;
      expect(el.getAttribute("title"), st).toBeTruthy();
      return el.getAttribute("data-shape");
    });
    expect(new Set(shapes).size).toBe(3);
  });
});

describe("All sessions table (02 F5, F8)", () => {
  const t = (over: Partial<TableSession>): TableSession => ({ key: "claude/work/a", title: "Checkout", state: "needs-you", live: true, tool: "claude", account: { name: "work", color: "teal" }, branch: "a11y", pr: { number: 311, ci: "FAILURE" }, model: null, thinking: null, contextPct: null, lastActiveMs: NOW - 21 * MIN, project: "p", projectRoot: "/p", worktree: null, ...over });
  it("CI is words like the sidebar, and the age uses the one format", () => {
    render(<AllSessionsPage sessions={[t({}), t({ key: "claude/work/b", title: "Green", pr: { number: 2, ci: "SUCCESS" } })]} nowMs={NOW} onOpen={vi.fn()} batch={() => batch} />);
    expect(screen.getByText("CI failing")).toBeTruthy();
    expect(screen.queryByLabelText("CI failing")).toBeNull();
    expect(screen.queryByLabelText("CI passed")).toBeNull();
    expect(screen.getAllByText("21m ago").length).toBe(2);
  });
});

describe("the design board 'comfortable' (02 F9)", () => {
  it("sets the comfortable density itself instead of toggling the default", () => {
    expect(BOARDS.comfortable.scene?.layout?.comfortable).toBe(true);
    expect(JSON.stringify(BOARDS.comfortable.steps ?? [])).not.toMatch(/Density/);
    expect(BOARDS.compact.scene?.layout?.comfortable).toBe(false);
  });
});

describe("subagents carry their task (04 F2)", () => {
  const cli = (over: Partial<CliRow> = {}): CliRow => ({ provider: "claude", profile: "work", sessionId: "p", projectDir: "-r", cwd: "/r", mtimeMs: NOW, live: true, summary: "p", ...over });
  it("the label is the type and the first line of its Task description; it brings what it runs now and when it started", () => {
    const kids = childrenOf(cli({ children: [{ kind: "subagent", agentId: "a1", type: "general-purpose", description: "migrate JSON stores", doing: "Bash · npm test", startedAt: new Date(NOW - 3 * MIN).toISOString(), state: "running", source: "hook" }, { kind: "subagent", agentId: "a2", type: "Explore", state: "done", source: "hook", startedAt: new Date(NOW - 9 * MIN).toISOString(), endedAt: new Date(NOW - 7 * MIN).toISOString() }] } as never));
    expect(kids[0]).toMatchObject({ label: "general-purpose · migrate JSON stores", doing: "Bash · npm test", startedMs: NOW - 3 * MIN });
    expect(kids[1]).toMatchObject({ label: "Explore", startedMs: NOW - 9 * MIN, endedMs: NOW - 7 * MIN });
    expect(kids[1].doing).toBeUndefined();
  });

  it("Summary counts children as the Children window does, in its words", () => {
    const r = cli({ children: [{ kind: "subagent", agentId: "a1", type: "Explore", state: "running", source: "hook" }], childCount: 3, childSource: "hook+counted" } as never);
    const vm = { ...emptyViewModel(NOW), sessionRows: [r] };
    const d = toV3Data(vm, emptyFeeds(), { now: NOW, appearance: DEFAULT_APPEARANCE, prefersDark: true, focusTerminal: true, engineDownSince: null, plan: { folder: "/r", gitState: null, worktree: false, tool: "claude", model: "opus", thinking: "high", where: "hosted" }, terminalApp: "Terminal.app", changes: new Map(), wantChanges: () => {} });
    const row = d.sessions.find((x) => x.key === "claude/work/p")!;
    expect(d.summary("claude/work/p")!.more.children).toBe(childNoun(row));
    expect(childNoun(row)).toBe("3 subagents");
  });
});

describe("subagents from Claude Code's own files, without our hooks (arena r2 04 F2)", () => {
  const cli = (over: Partial<CliRow> = {}): CliRow => ({ provider: "claude", profile: "work", sessionId: "p", projectDir: "-r", cwd: "/r", mtimeMs: NOW, live: true, summary: "p", ...over });
  const files = { kind: "subagent", agentId: "a7", type: "general-purpose", description: "Phase 1: honest actions", state: "running", source: "files", cwd: "/r/.claude/worktrees/agent-a7", toolUseId: "toolu_1", startedAt: new Date(NOW - 5 * MIN).toISOString() };

  it("a files subagent keeps its source, task, worktree and start, and opens its transcript like a hook one", () => {
    const [k] = childrenOf(cli({ children: [files], childCount: 1, childSource: "files" } as never));
    expect(k).toMatchObject({ id: "a7", source: "files", label: "general-purpose · Phase 1: honest actions", worktree: "agent-a7", startedMs: NOW - 5 * MIN, state: "working" });
    const onSubagent = vi.fn();
    const { container } = render(<SessionRow s={s("claude/work/p", { children: [k] })} open onSelect={vi.fn()} onToggleChildren={vi.fn()} onCheck={vi.fn()} onSubagent={onSubagent} />);
    const row = container.querySelector<HTMLElement>("[data-child-row]")!;
    expect(row.getAttribute("role")).toBe("button");
    expect(row.getAttribute("title")).toMatch(/from Claude Code's files/);
    expect(row.getAttribute("title")).not.toMatch(/nothing to open|via hook/);
    fireEvent.click(row);
    expect(onSubagent).toHaveBeenCalledWith("claude/work/p", "a7");
  });

  it("only what cannot be read stays a count with nothing to open", () => {
    const kids = childrenOf(cli({ children: [files], childCount: 3, childSource: "files+counted" } as never));
    expect(kids.map((k) => [k.source, k.count ?? null])).toEqual([["files", null], ["counted", 2]]);
    render(<ChildrenWindow noun="3 subagents" children={kids} onHide={vi.fn()} onOpen={vi.fn()} subagents />);
    expect(screen.getByRole("button", { name: /Phase 1: honest actions/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /2 subagents/ })).toBeNull();
  });

  it("the chat's Task row knows its worktree while the subagent runs, by the Task call's id", () => {
    const wt = worktreeOf(cli({ children: [files] } as never));
    expect(wt("toolu_1")).toBe("agent-a7");
    expect(wt("a7")).toBe("agent-a7");
  });
});

describe("Children rows open (04 F3) and a subagent opens read-only (04 F1)", () => {
  it("a session child in the Children window opens like in the tree; a hook subagent opens its view; a counted row does not", () => {
    const onOpen = vi.fn();
    const kids: ChildModel[] = [{ id: "claude/work/seat", label: "seat", kind: "council", state: "done", source: "lineage" }, sub("a1"), { id: "c", label: "subagents", kind: "subagent", state: "done", source: "counted", count: 2 }];
    render(<ChildrenWindow noun="4 related sessions" children={kids} onHide={vi.fn()} onOpen={onOpen} />);
    // Running open, Idle folded (owner, 2026-11-24): all three are idle here.
    fireEvent.click(screen.getByRole("button", { name: /^Idle/, expanded: false }));
    fireEvent.click(screen.getByRole("button", { name: /seat/ }));
    fireEvent.click(screen.getByRole("button", { name: /migrate JSON stores/ }));
    expect(onOpen.mock.calls.map((c) => c[0].id)).toEqual(["claude/work/seat", "a1"]);
    expect(screen.queryByRole("button", { name: /2 subagents/ })).toBeNull();
  });

  it("a subagent row in the tree is a button that opens it under its parent", () => {
    const onSubagent = vi.fn();
    const { container } = render(<SessionRow s={s("claude/work/p", { children: [sub("a1")] })} open onSelect={vi.fn()} onToggleChildren={vi.fn()} onCheck={vi.fn()} onSubagent={onSubagent} />);
    const row = container.querySelector<HTMLElement>("[data-child-row]")!;
    expect(row.getAttribute("role")).toBe("button");
    expect(row.getAttribute("title")).not.toMatch(/nothing to open/);
    fireEvent.click(row);
    expect(onSubagent).toHaveBeenCalledWith("claude/work/p", "a1");
  });

  it("the window: Children opens the subagent's transcript read-only with its tool and time, and Back returns to the parent", () => {
    const d: V3Data = { ...data(), sessions: [{ ...data().sessions[0], children: [sub("a1", { doing: "Bash · npm test", startedMs: NOW - 4 * MIN })] }] };
    const subagent = vi.fn((parent: string, id: string) => <p>transcript of {parent} / {id}</p>);
    render(<V3Window data={d} slots={{ ...slots, subagent }} act={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /^Children/ }));
    const win = screen.getByRole("complementary", { name: /Children/ });
    fireEvent.click(within(win).getByRole("button", { name: /migrate JSON stores/ }));
    const view = screen.getByRole("region", { name: "Subagent" });
    expect(within(view).getByText("transcript of s1 / a1")).toBeTruthy();
    expect(within(view).getByText("Bash · npm test")).toBeTruthy();
    expect(within(view).getByText(/4m/)).toBeTruthy();
    expect(within(view).getByText(/read-only/i)).toBeTruthy();
    fireEvent.click(within(view).getByRole("button", { name: /Back to Event store/ }));
    expect(screen.queryByRole("region", { name: "Subagent" })).toBeNull();
  });

  it("the app's subagent slot reads that subagent's transcript under its parent and draws it read-only", async () => {
    const read = vi.fn(async () => ({ events: [{ t: "message", id: "m1", role: "assistant", text: "Migrated 3 stores.", images: 0 }] as never, from: 0, total: 1, version: null, newerThanFixtures: false, truncated: false }));
    render(<SubagentTranscript parent="claude/work/p" agentId="a1" read={read} />);
    expect(await screen.findByText("Migrated 3 stores.")).toBeTruthy();
    expect(read).toHaveBeenCalledWith("claude/work/p", "a1");
  });

  it("the app's subagent slot says when only the end of a long run is shown (arena r2 04 F3)", async () => {
    const ev = [{ t: "message", id: "m1", role: "assistant", text: "Late step.", images: 0 }] as never;
    const cut = vi.fn(async () => ({ events: ev, from: 0, total: 1, version: null, newerThanFixtures: false, truncated: true }));
    render(<SubagentTranscript parent="claude/work/p" agentId="a1" read={cut} />);
    expect(await screen.findByText("Late step.")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/Earlier steps not shown/);
    cleanup();
    const paged = vi.fn(async () => ({ events: ev, from: 12, total: 13, version: null, newerThanFixtures: false, truncated: false }));
    render(<SubagentTranscript parent="claude/work/p" agentId="a1" read={paged} />);
    expect(await screen.findByText(/Earlier steps not shown/)).toBeTruthy();
    cleanup();
    const whole = vi.fn(async () => ({ events: ev, from: 0, total: 1, version: null, newerThanFixtures: false, truncated: false }));
    render(<SubagentTranscript parent="claude/work/p" agentId="a1" read={whole} />);
    expect(await screen.findByText("Late step.")).toBeTruthy();
    expect(screen.queryByText(/Earlier steps not shown/)).toBeNull();
  });

  it("the Children stripe button has its own icon, not the Git branch", () => {
    const { container } = render(<>{rightItems(false).find((i) => i.id === "children")!.icon}</>);
    expect(container.querySelector("svg")!.getAttribute("class")).not.toMatch(/git-branch/);
  });
});
