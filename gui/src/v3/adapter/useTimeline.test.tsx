/** 9.2: polls that resolve out of order never roll the timeline back, and a page of
 *  earlier turns that arrives after the newest page moved on drops nothing between them. */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { TIMELINE_POLL_MS, useTimeline, type TimelineRead } from "./useTimeline.js";
import type { AsEvent } from "../timeline.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const ev = (i: number) => ({ t: "message", role: "assistant", id: `e${i}`, text: `e${i}` }) as unknown as AsEvent;
const range = (a: number, b: number) => Array.from({ length: b - a }, (_, k) => ev(a + k));
const ids = (events: readonly AsEvent[]) => events.map((e) => (e as unknown as { id: string }).id);
type Reply = Awaited<ReturnType<TimelineRead>>;
const page = (from: number, end: number): Reply => ({ events: range(from, end), from, earlierPrompts: from, version: null, newerThanFixtures: false });

/** A reader whose answers the test hands out, in any order. */
function controlled() {
  const calls: { at?: { before?: number; from?: number }; resolve: (r: Reply) => void }[] = [];
  const read = vi.fn((_key: string, at?: { before?: number; from?: number }) => new Promise<Reply>((resolve) => void calls.push({ at, resolve })));
  return { calls, read: read as unknown as TimelineRead };
}
const settle = () => act(async () => void (await Promise.resolve()));

describe("useTimeline under out-of-order answers", () => {
  it("an older poll answering after a newer one never rolls the timeline back", async () => {
    vi.useFakeTimers({ toFake: ["setInterval"] });
    const { calls, read } = controlled();
    const h = renderHook(() => useTimeline("claude/w/s", read));
    await act(async () => void vi.advanceTimersByTime(TIMELINE_POLL_MS));
    expect(calls).toHaveLength(2);
    // The second read answers first with the grown file; the first, older one arrives after it.
    await act(async () => calls[1].resolve(page(10, 30)));
    await act(async () => calls[0].resolve(page(5, 20)));
    await settle();
    expect(ids(h.result.current.events)).toEqual(ids(range(10, 30)));
  });

  it("earlier turns join the snapshot by index: nothing doubled, nothing dropped", async () => {
    const { calls, read } = controlled();
    const h = renderHook(() => useTimeline("claude/w/s", read));
    await act(async () => calls[0].resolve(page(100, 150)));
    expect(h.result.current.earlier?.prompts).toBe(100);
    let loading!: Promise<void>;
    act(() => void (loading = h.result.current.earlier!.load()));
    expect(calls[1].at).toEqual({ before: 100 });
    await act(async () => calls[1].resolve(page(50, 100)));
    await act(async () => loading);
    await settle();
    // The earlier page ends at 100; the snapshot it joins starts at 100 — joined by index, nothing doubled.
    expect(ids(h.result.current.events)).toEqual(ids(range(50, 150)));
  });

  it("the newest page moved past the loaded one meanwhile: the gap is read, not skipped", async () => {
    vi.useFakeTimers({ toFake: ["setInterval"] });
    const { calls, read } = controlled();
    const h = renderHook(() => useTimeline("claude/w/s", read));
    await act(async () => calls[0].resolve(page(100, 150)));
    // A poll goes out; the load starts from the snapshot it has (from 100).
    await act(async () => void vi.advanceTimersByTime(TIMELINE_POLL_MS));
    let loading!: Promise<void>;
    act(() => void (loading = h.result.current.earlier!.load()));
    expect(calls.map((c) => c.at)).toEqual([undefined, undefined, { before: 100 }]);
    // The poll answers first: the newest page now starts at 120.
    await act(async () => calls[1].resolve(page(120, 170)));
    expect(ids(h.result.current.events)[0]).toBe("e120");
    // Then the earlier page [50, 100): 100–119 lie between the two; they are read, never dropped.
    await act(async () => calls[2].resolve(page(50, 100)));
    await settle();
    expect(calls.at(-1)?.at).toEqual({ from: 50 });
    expect(ids(h.result.current.events)[0]).toBe("e120");
    await act(async () => calls.at(-1)!.resolve(page(50, 170)));
    await act(async () => loading);
    expect(ids(h.result.current.events)).toEqual(ids(range(50, 170)));
    // Never shown with a hole in between, either.
    const shown = ids(h.result.current.events).map((i) => Number(i.slice(1)));
    expect(shown.every((n, k) => k === 0 || n === shown[k - 1] + 1)).toBe(true);
  });
});
