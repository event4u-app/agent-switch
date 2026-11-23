/** 8.3: the whole conversation is reachable — earlier turns load on demand, Copy
 *  copies all of it, and cards from before a chat opened say how to answer. */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import fx from "./fixtures/timeline-claude-2.1.316.json";
import { ChatTimeline, CopyConversation, STALE_CARD } from "./chat.js";
import { ChatView } from "./chatview.js";
import { sessionMarkdown } from "./chat-export.js";
import { fold, type AsEvent } from "./timeline.js";
import { VirtualList } from "./virtual.js";
import { useTimeline, type TimelineRead } from "./adapter/useTimeline.js";
import { useBridge, type BridgeDeps } from "./adapter/useBridge.js";
import { ReadOnlyTimeline } from "./adapter/slots.js";
import type * as ipc from "../ipc.js";

afterEach(cleanup);
const base = fx.transcript as AsEvent[];
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

/** The recorded turn `n` times over with fresh ids: many prompts, hundreds of tool events. */
function conversation(n: number): AsEvent[] {
  return Array.from({ length: n }, (_, k) =>
    base.map((e) => {
      const o = { ...e } as Record<string, unknown>;
      for (const f of ["id", "toolId"]) if (typeof o[f] === "string") o[f] = `${o[f]}-${k}`;
      return o as AsEvent;
    }),
  ).flat();
}
const prompts = (ev: readonly AsEvent[]) => ev.filter((e) => e.t === "message" && e.role === "user").length;

/** A fake `timeline --json` over `all`: pages of `size` events, `before` / `from` as the CLI takes them. */
function fakeCli(all: AsEvent[], size: number) {
  return vi.fn(async (_key: string, at?: { before?: number; from?: number }) => {
    const end = at?.before ?? all.length;
    const start = at?.from ?? Math.max(0, end - size);
    return { events: all.slice(start, end), from: start, total: all.length, earlierPrompts: prompts(all.slice(0, start)), hidden: { attachment: 3 }, version: "2.1.316", newerThanFixtures: false };
  });
}

describe("the read-only chat reaches the whole conversation", () => {
  it("says how many prompts lie before the page and loads them on demand, then keeps following from there", async () => {
    vi.useFakeTimers({ toFake: ["setInterval"] });
    const all = conversation(40);
    const read = fakeCli(all, 300);
    function Probe() {
      const t = useTimeline("claude/w/s", read as TimelineRead);
      return <ReadOnlyTimeline t={t} where="your terminal" />;
    }
    render(<Probe />);
    await flush();
    expect(read).toHaveBeenLastCalledWith("claude/w/s");
    const more = screen.getByRole("button", { name: /earlier prompts — load more/ });
    expect(more.textContent).toContain(`${prompts(all.slice(0, all.length - 300))} earlier prompts`);
    await act(async () => void fireEvent.click(more));
    await flush();
    expect(read).toHaveBeenLastCalledWith("claude/w/s", { before: all.length - 300 });
    // The poll now reads everything from the earliest loaded index, so nothing in between is lost.
    await act(async () => void vi.advanceTimersByTime(4000));
    await flush();
    expect(read).toHaveBeenLastCalledWith("claude/w/s", { from: all.length - 600 });
    vi.useRealTimers();
    while (screen.queryByRole("button", { name: /load more/ })) {
      await act(async () => void fireEvent.click(screen.getByRole("button", { name: /load more/ })));
      await flush();
    }
    expect(read.mock.calls.at(-1)?.[1]).toEqual({ before: expect.any(Number) });
    expect(screen.queryByRole("button", { name: /load more/ })).toBeNull();
  });

  it("a reader that cannot page (a subagent's) offers no load-more", async () => {
    const read = vi.fn(async () => ({ events: base, from: 5, total: base.length + 5, version: null, newerThanFixtures: false }));
    function Probe() {
      const t = useTimeline("p", read as TimelineRead);
      return <ReadOnlyTimeline t={t} />;
    }
    render(<Probe />);
    await flush();
    expect(screen.queryByRole("button", { name: /load more/ })).toBeNull();
  });

  it("the hint names Focus terminal only where that button exists", () => {
    const t = { events: [{ t: "approval.requested", id: "a", tool: "Bash", summary: "ls", input: {} }] as AsEvent[], version: null, newerThanFixtures: false, error: null, loaded: true, earlier: null, hidden: {}, cut: false };
    const { rerender } = render(<ReadOnlyTimeline t={t} where="iTerm2" focusable />);
    expect(screen.getByText("Answer it in iTerm2 — Focus terminal brings it up.")).toBeTruthy();
    rerender(<ReadOnlyTimeline t={t} where="Claude Desktop" focusable={false} />);
    expect(screen.getByText("Answer it in Claude Desktop.")).toBeTruthy();
    expect(screen.queryByText(/Focus terminal/)).toBeNull();
  });
});

describe("the list keeps its place when earlier rows arrive", () => {
  it("prepending rows leaves the rows the user was reading where they were", () => {
    const items = Array.from({ length: 40 }, (_, i) => `r${i}`);
    const { rerender } = render(<VirtualList label="L" items={items.slice(20)} keyOf={(x) => x} render={(x) => <p>{x}</p>} />);
    const log = screen.getByRole("log");
    // jsdom lays nothing out: a tall list, scrolled away from the bottom.
    Object.defineProperty(log, "scrollHeight", { configurable: true, value: 5000 });
    Object.defineProperty(log, "clientHeight", { configurable: true, value: 400 });
    fireEvent.scroll(log, { target: { scrollTop: 100 } });
    rerender(<VirtualList label="L" items={items} keyOf={(x) => x} render={(x) => <p>{x}</p>} />);
    // 20 new rows at the 64 px estimate sit above the row that was at the top.
    expect(log.scrollTop).toBe(20 * 64 + 100);
  });

  it("loading earlier turns while at the bottom shows them: the pin lets go and the loaded rows fill the view (arena r3 03 #3)", () => {
    const items = Array.from({ length: 40 }, (_, i) => `r${i}`);
    const { rerender } = render(<VirtualList label="L" items={items.slice(20)} keyOf={(x) => x} render={(x) => <p>{x}</p>} />);
    const log = screen.getByRole("log");
    Object.defineProperty(log, "scrollHeight", { configurable: true, value: 5000 });
    Object.defineProperty(log, "clientHeight", { configurable: true, value: 600 });
    fireEvent.scroll(log, { target: { scrollTop: 4400 } });
    rerender(<VirtualList label="L" items={items} keyOf={(x) => x} render={(x) => <p>{x}</p>} />);
    // The row that was first sits in the lower third; the loaded turns above it are in view.
    expect(log.scrollTop).toBe(20 * 64 - 400);
    // Not pinned to the bottom any more: a later render keeps the place.
    rerender(<VirtualList label="L" items={[...items]} keyOf={(x) => x} render={(x) => <p>{x}</p>} />);
    expect(log.scrollTop).toBe(20 * 64 - 400);
  });
});

describe("Copy conversation copies all of it", () => {
  it("reads what is not loaded before copying, and says so", async () => {
    const all = conversation(3);
    const loaded = fold(all.slice(base.length)).rows;
    let copied: Promise<string> | null = null;
    class Item {
      constructor(data: Record<string, Promise<Blob>>) {
        copied = data["text/plain"].then(
          (b) =>
            new Promise<string>((res) => {
              const r = new FileReader();
              r.onload = () => res(String(r.result));
              r.readAsText(b);
            }),
        );
      }
    }
    vi.stubGlobal("ClipboardItem", Item);
    Object.assign(navigator, { clipboard: { write: vi.fn(async () => {}), writeText: vi.fn() } });
    const full = vi.fn(async () => fold(all).rows);
    render(<CopyConversation rows={loaded} full={full} />);
    const button = screen.getByLabelText("Copy conversation");
    expect(button.getAttribute("title")).toMatch(/earlier turns are read first/);
    await act(async () => void fireEvent.click(button));
    await flush();
    expect(full).toHaveBeenCalledOnce();
    expect(await copied).toBe(sessionMarkdown(fold(all).rows));
    expect(screen.getByLabelText("Copied")).toBeTruthy();
    vi.unstubAllGlobals();
  });
});

describe("the chat window", () => {
  const question: AsEvent = { t: "question.requested", id: "toolu_Q", questions: [{ question: "Which db?", options: ["pg", "sqlite"] }] };
  function chatWith(history: AsEvent[], from = 0, earlierPrompts = 0) {
    let line: (l: string) => void = () => {};
    const historyFn = vi.fn(async (_k: string, before?: number) => (before === undefined ? { events: history, from, earlierPrompts } : { events: base, from: 0, earlierPrompts: 0 }));
    const deps: BridgeDeps = {
      history: historyFn,
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
    return { historyFn, line: (o: object) => act(() => line(JSON.stringify(o))) };
  }

  it("loads earlier turns on demand", async () => {
    const c = chatWith(base.slice(-3), 40, 2);
    await flush();
    c.line({ bridge: "ready", key: "claude/w/s1", mode: "default" });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "2 earlier prompts — load more" })));
    await flush();
    expect(c.historyFn).toHaveBeenLastCalledWith("claude/w/s1", 40);
    expect(screen.queryByRole("button", { name: /load more/ })).toBeNull();
    expect(screen.getAllByText(/Create a file notes\.md/).length).toBeGreaterThan(0);
  });

  it("a question left open before the chat opened says how to answer instead of offering a dead Answer", async () => {
    const c = chatWith([{ t: "message", id: "u", role: "user", text: "hi", images: 0 }, question]);
    await flush();
    c.line({ bridge: "ready", key: "claude/w/s1", mode: "default" });
    expect(screen.getByText(STALE_CARD)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Answer" })).toBeNull();
    // The agent asks it again live: one card, answerable.
    c.line({ event: { t: "question.requested", id: "req-1", toolId: "toolu_Q", questions: [{ question: "Which db?", options: ["pg", "sqlite"] }] } });
    expect(screen.queryByText(STALE_CARD)).toBeNull();
    expect(screen.getByRole("button", { name: "Answer" })).toBeTruthy();
  });
});

describe("ChatTimeline", () => {
  it("draws no load-more row when nothing lies before", () => {
    render(<ChatTimeline events={base} />);
    expect(screen.queryByRole("button", { name: /load more/ })).toBeNull();
  });
});
