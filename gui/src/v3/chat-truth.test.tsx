/** Phase 7.4: a question shows once and its answer reaches the bridge; Other,
 *  multi-select and skip; answered questions say so; "Always allow" names its
 *  rule; printed keys work; the agent is named; the read-only chat follows the
 *  selected session; the send button and suggestions tell the truth. */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

import { ChatTimeline } from "./chat.js";
import { ChatView } from "./chatview.js";
import { Composer } from "./composer.js";
import { fold, type AsEvent } from "./timeline.js";
import { useBridge, type BridgeDeps } from "./adapter/useBridge.js";
import { useTimeline } from "./adapter/useTimeline.js";
import { ReadOnlyTimeline } from "./adapter/slots.js";
import type { Chat } from "./adapter/chats.js";
import type * as ipc from "../ipc.js";

afterEach(cleanup);

const Q = [{ question: "Colour?", options: ["Red", "Blue"] }];
/** The live order: the tool call, its question, then the control request for it. */
const live: AsEvent[] = [
  { t: "turn", id: "u", at: null },
  { t: "tool.started", id: "toolu_Q", name: "AskUserQuestion", summary: "", input: {}, parentToolId: null },
  { t: "question.requested", id: "toolu_Q", questions: Q },
  { t: "question.requested", id: "req-1", toolId: "toolu_Q", questions: Q },
];

function chat(over: Partial<Chat> = {}): Chat {
  return {
    events: live,
    status: "ready",
    error: null,
    queued: 0,
    mode: "default",
    session: { key: "claude/w/s", model: null, commands: [] },
    send: vi.fn(),
    steer: vi.fn(),
    approve: vi.fn(),
    deny: vi.fn(),
    answer: vi.fn(),
    interrupt: vi.fn(),
    review: vi.fn(),
    setModel: vi.fn(),
    setMode: vi.fn(),
    close: vi.fn(),
    ...over,
  };
}

describe("fold: one question per question", () => {
  it("the tool call and its control request become one card keyed by the request; no AskUserQuestion tool row", () => {
    const f = fold(live);
    expect(f.rows.map((r) => `${r.k}:${r.id}`)).toEqual(["question:req-1"]);
  });

  it("an answer resolves it, by either id; a skip resolves it without answers", () => {
    const byTool = fold([...live, { t: "question.resolved", id: "toolu_Q", answers: { "Colour?": "Red" } }]);
    expect(byTool.rows[0]).toMatchObject({ k: "question", resolved: { answers: { "Colour?": "Red" } } });
    const byReq = fold([...live, { t: "question.resolved", id: "req-1", answers: null }]);
    expect(byReq.rows[0]).toMatchObject({ k: "question", resolved: { answers: null } });
    // A transcript has the tool call only.
    const t = fold([live[1], live[2], { t: "tool.finished", id: "toolu_Q", ok: true, summary: "" }, { t: "question.resolved", id: "toolu_Q", answers: { "Colour?": "Blue" } }]);
    expect(t.rows.map((r) => r.k)).toEqual(["question"]);
    expect(t.rows[0]).toMatchObject({ resolved: { answers: { "Colour?": "Blue" } } });
  });
});

describe("the question card", () => {
  it("in a live chat: one card, and the pick goes to the bridge under the request id", () => {
    const c = chat();
    render(<ChatView b={c} />);
    expect(screen.getAllByRole("radiogroup")).toHaveLength(1);
    fireEvent.click(screen.getByRole("radio", { name: "Blue" }));
    expect(c.answer).toHaveBeenCalledWith("req-1", { "Colour?": "Blue" });
  });

  it("Other: a typed answer goes as the answer", () => {
    const answer = vi.fn();
    render(<ChatTimeline events={live} on={{ answer }} />);
    fireEvent.change(screen.getByLabelText("Other answer to Colour?"), { target: { value: "Green, please" } });
    fireEvent.click(screen.getByRole("button", { name: "Answer" }));
    expect(answer).toHaveBeenCalledWith("req-1", { "Colour?": "Green, please" });
  });

  it("multi-select: several picks go together once you answer", () => {
    const answer = vi.fn();
    const ev: AsEvent[] = [{ t: "question.requested", id: "q", questions: [{ question: "Which?", options: ["A", "B", "C"], multiSelect: true }] }];
    render(<ChatTimeline events={ev} on={{ answer }} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "A" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "C" }));
    expect(answer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Answer" }));
    expect(answer).toHaveBeenCalledWith("q", { "Which?": "A, C" });
  });

  it("skip: the question is declined through the bridge", () => {
    const c = chat();
    render(<ChatView b={c} />);
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(c.deny).toHaveBeenCalledWith("req-1", expect.stringMatching(/skipped/));
  });

  it("an answered question shows its answer and offers nothing; a skipped one says so", () => {
    const { unmount } = render(<ChatTimeline events={[...live, { t: "question.resolved", id: "req-1", answers: { "Colour?": "Red" } }]} on={{ answer: vi.fn() }} />);
    expect(screen.getByText("Red").closest("[data-answered]")).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();
    unmount();
    render(<ChatTimeline events={[...live, { t: "question.resolved", id: "req-1", answers: null }]} />);
    expect(screen.getByText(/Not answered/)).toBeTruthy();
  });

  it("read-only: says to answer it in the terminal", () => {
    render(<ChatTimeline events={live} />);
    expect(screen.getByText(/Answer it in the terminal/)).toBeTruthy();
  });
});

describe("the approval card", () => {
  const ask = (rule?: string): AsEvent[] => [{ t: "approval.requested", id: "r1", tool: "Bash", summary: "npx vitest run", input: {}, ...(rule ? { rule } : {}) }];

  it("Always allow names the rule it adds; without a suggestion it is not offered", () => {
    const approve = vi.fn();
    const { unmount } = render(<ChatTimeline events={ask("allow Bash(npx vitest:*) in this project")} on={{ approve, deny: vi.fn() }} />);
    fireEvent.click(screen.getByRole("button", { name: "Always: allow Bash(npx vitest:*) in this project" }));
    expect(approve).toHaveBeenCalledWith("r1", true);
    unmount();
    render(<ChatTimeline events={ask()} on={{ approve, deny: vi.fn() }} />);
    expect(screen.queryByText(/Always/)).toBeNull();
    expect(screen.queryByText(/npx”/)).toBeNull();
  });

  it("↵ allows once while the card has focus", () => {
    const approve = vi.fn();
    render(<ChatTimeline events={ask()} on={{ approve, deny: vi.fn() }} />);
    fireEvent.keyDown(screen.getByRole("group", { name: /wants to run a command/ }), { key: "Enter" });
    expect(approve).toHaveBeenCalledWith("r1", false);
  });

  it("a Codex chat says Codex; read-only says to answer in the terminal", () => {
    render(<ChatTimeline agent="Codex" events={ask()} />);
    expect(screen.getByText(/Codex wants to run a command/)).toBeTruthy();
    expect(screen.getByText(/Answer it in the terminal/)).toBeTruthy();
  });

  it("a session elsewhere names the Focus terminal button only where it is offered", () => {
    const t = { loaded: true, events: ask(), error: null, newerThanFixtures: false, version: null } as unknown as Parameters<typeof ReadOnlyTimeline>[0]["t"];
    const { unmount } = render(<ReadOnlyTimeline t={t} where="iTerm2" canFocus />);
    expect(screen.getByText("Answer it in iTerm2 — Focus terminal brings it up.")).toBeTruthy();
    unmount();
    render(<ReadOnlyTimeline t={t} where="your terminal" canFocus={false} />);
    expect(screen.getByText("Answer it in your terminal.")).toBeTruthy();
    expect(screen.queryByText(/Focus terminal brings it up/)).toBeNull();
  });

  it("ChatView names the agent from the session key", () => {
    render(<ChatView b={chat({ events: ask(), session: { key: "codex/w/t", model: null, commands: [] } })} />);
    expect(screen.getByText(/Codex wants to run a command/)).toBeTruthy();
  });
});

describe("bridge errors while the chat is ready", () => {
  it("show in the conversation instead of vanishing", async () => {
    let line: (l: string) => void = () => {};
    const deps: BridgeDeps = {
      history: vi.fn(async () => []),
      open: vi.fn(async (_s: ipc.BridgeSpec, onLine: (l: string) => void) => {
        line = onLine;
        return { send: async () => {}, kill: async () => {} };
      }),
    };
    function Probe() {
      const b = useBridge({ key: "claude/w/s1", mode: "default" }, deps);
      return <ChatView b={b} />;
    }
    render(<Probe />);
    await act(async () => void (await new Promise((r) => setTimeout(r, 0))));
    act(() => line(JSON.stringify({ bridge: "ready", key: "claude/w/s1", mode: "default" })));
    act(() => line(JSON.stringify({ bridge: "error", message: "no open question toolu_X" })));
    expect(screen.getByRole("alert").textContent).toContain("no open question toolu_X");
  });
});

describe("the read-only chat follows the selected session", () => {
  it("a new key shows nothing of the old session while it is read", async () => {
    const read = vi.fn((key: string) => (key === "a" ? Promise.resolve({ events: [{ t: "message", id: "m", role: "user", text: "from A", images: 0 }] as AsEvent[], version: null, newerThanFixtures: false }) : new Promise<never>(() => {})));
    let setKey: (k: string) => void = () => {};
    function Probe() {
      const [k, set] = useState("a");
      setKey = set;
      const t = useTimeline(k, read as never);
      return <p>{t.loaded ? t.events.map((e) => (e.t === "message" ? e.text : "")).join() : "reading"}</p>;
    }
    render(<Probe />);
    await act(async () => void (await new Promise((r) => setTimeout(r, 0))));
    expect(screen.getByText("from A")).toBeTruthy();
    act(() => setKey("b"));
    expect(screen.queryByText("from A")).toBeNull();
    expect(screen.getByText("reading")).toBeTruthy();
  });
});

describe("the composer", () => {
  const props = { queued: 0, mode: "default" as const, onMode: vi.fn(), onSend: vi.fn(), onStop: vi.fn() };

  it("says Send when nothing runs and Queue only while a turn runs", () => {
    const { rerender } = render(<Composer {...props} running={false} />);
    expect(screen.getByRole("button", { name: /Send/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Queue/ })).toBeNull();
    rerender(<Composer {...props} running />);
    expect(screen.getByRole("button", { name: /Queue/ })).toBeTruthy();
  });

  it("↑/↓ move through the suggestions, Enter takes the selected one", () => {
    const onSend = vi.fn();
    render(<Composer {...props} onSend={onSend} running={false} commands={["compact", "clear", "review"]} />);
    const box = screen.getByLabelText("Message") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "/", selectionStart: 1 } });
    expect(screen.getAllByRole("option").map((o) => o.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(screen.getByRole("option", { selected: true }).textContent).toBe("/review");
    fireEvent.keyDown(box, { key: "ArrowUp" });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(box.value).toBe("/clear ");
  });
});
