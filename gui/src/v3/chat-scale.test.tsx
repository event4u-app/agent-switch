import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import fx from "./fixtures/timeline-claude-2.1.316.json";
import { ChatTimeline } from "./chat.js";
import type { AsEvent } from "./timeline.js";
import { useTimeline } from "./adapter/useTimeline.js";

afterEach(cleanup);
const base = fx.transcript as AsEvent[];

/** A session of `turns` turns, each a copy of the recorded one with fresh ids. */
function session(seed: number, turns: number): AsEvent[] {
  return Array.from({ length: turns }, (_, k) =>
    base.map((e) => {
      const tag = `-${seed}-${k}`;
      const o = { ...e } as Record<string, unknown>;
      for (const f of ["id", "toolId"]) if (typeof o[f] === "string") o[f] = `${o[f]}${tag}`;
      return o as AsEvent;
    }),
  ).flat();
}

describe("timelines at scale", () => {
  it("50 sessions render one after another, each with its prompts on screen", () => {
    const t0 = performance.now();
    for (let i = 0; i < 50; i++) {
      const { unmount } = render(<ChatTimeline events={session(i, 3)} />);
      expect(screen.getAllByText(/Create a file notes\.md/).length).toBeGreaterThan(0);
      unmount();
    }
    expect(performance.now() - t0).toBeLessThan(15_000);
  });

  it("a long session keeps only the rows near the viewport in the DOM", () => {
    const events = session(0, 300); // 2700 rows
    render(<ChatTimeline events={events} />);
    const log = screen.getByRole("log", { name: "Conversation" });
    const rendered = log.firstElementChild!.firstElementChild!.children.length;
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(60);
  });
});

function Probe({ k, read }: { k: string | null; read: Parameters<typeof useTimeline>[1] }) {
  const t = useTimeline(k, read);
  return <p>{t.loaded ? (t.error ? `error: ${t.error}` : `${t.events.length} events · ${t.version}`) : "loading"}</p>;
}

describe("useTimeline", () => {
  it("reads the session, then keeps reading while visible; an error keeps the last events", async () => {
    vi.useFakeTimers();
    const read = vi
      .fn()
      .mockResolvedValueOnce({ events: base, from: 0, total: base.length, version: "2.1.316", newerThanFixtures: false })
      .mockRejectedValueOnce(new Error("gone"));
    render(<Probe k="claude/w/s" read={read} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText(`${base.length} events · 2.1.316`)).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(4000);
      await Promise.resolve();
    });
    vi.useRealTimers();
    await waitFor(() => expect(screen.getByText("error: gone")).toBeTruthy());
    expect(read).toHaveBeenCalledWith("claude/w/s");
  });

  it("no session, no read", () => {
    const read = vi.fn();
    render(<Probe k={null} read={read} />);
    expect(read).not.toHaveBeenCalled();
    expect(screen.getByText("loading")).toBeTruthy();
  });
});
