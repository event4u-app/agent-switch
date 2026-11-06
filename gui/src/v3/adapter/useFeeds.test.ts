import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { emptyFeeds, pollFeeds, useV3Feeds, type FeedDeps } from "./useFeeds.js";

const ok = <T,>(v: T) => vi.fn(async () => v);
const fail = () => vi.fn(async () => { throw new Error("cli down"); });

function deps(over: Partial<FeedDeps> = {}): FeedDeps {
  return {
    needs: ok({ items: [], away: null, history: [] }),
    engine: ok({ running: true, reason: null, hostedRunning: 1 }),
    host: ok({ mode: "persistent" as const, hosted: [] }),
    library: ok({ autoKeep: true, vaultBytes: 0, entries: [] }),
    openTargets: ok({ default: null, perRepo: {}, lastUsed: null, targets: [], terminal: null, terminals: [] }),
    agents: ok({ agents: [], suggestions: [] }),
    remote: ok({ remoteControlAccounts: [], ssh: false }),
    codexRows: ok([]),
    ...over,
  };
}

describe("pollFeeds", () => {
  it("a fast round leaves the slow feeds unread", async () => {
    const d = deps();
    const f = await pollFeeds(emptyFeeds(), d, false, 100);
    expect(d.library).not.toHaveBeenCalled();
    expect(d.openTargets).not.toHaveBeenCalled();
    expect(d.agents).not.toHaveBeenCalled();
    expect(d.remote).not.toHaveBeenCalled();
    expect(f.engine?.running).toBe(true);
    expect(f.readAt).toEqual({ needs: 100, engine: 100, host: 100, codexRows: 100 });
  });

  it("a slow round reads everything", async () => {
    const f = await pollFeeds(emptyFeeds(), deps(), true, 5);
    expect(Object.keys(f.readAt).sort()).toEqual(["agents", "codexRows", "engine", "host", "library", "needs", "openTargets", "remote"]);
  });

  it("a failing read keeps the last good value and its time", async () => {
    const first = await pollFeeds(emptyFeeds(), deps(), true, 1);
    const second = await pollFeeds(first, deps({ engine: fail(), host: fail() }), false, 2);
    expect(second.engine).toEqual(first.engine);
    expect(second.readAt.engine).toBe(1);
    expect(second.readAt.needs).toBe(2);
    expect(second.host).toEqual(first.host);
  });

  it("everything failing on the first read leaves the empty state", async () => {
    const all = fail();
    const f = await pollFeeds(emptyFeeds(), { needs: all, engine: all, host: all, library: all, openTargets: all, agents: all, remote: all, codexRows: all }, true, 1);
    expect(f).toEqual(emptyFeeds());
  });
});

describe("useV3Feeds", () => {
  it("reads at once when the window is shown or focused, not on the next tick", async () => {
    const d = deps();
    const { result, unmount } = renderHook(() => useV3Feeds(d));
    await waitFor(() => expect(result.current.feeds.readAt.needs).toBeDefined());
    expect(d.needs).toHaveBeenCalledTimes(1);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(d.needs).toHaveBeenCalledTimes(2));
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(d.needs).toHaveBeenCalledTimes(3));
    unmount();
    window.dispatchEvent(new Event("focus"));
    await new Promise((r) => setTimeout(r, 20));
    expect(d.needs).toHaveBeenCalledTimes(3);
  });
});
