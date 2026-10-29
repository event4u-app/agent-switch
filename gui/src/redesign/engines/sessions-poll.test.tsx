import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import type { SessionRow } from "../../transforms.js";
import { emptyViewModel } from "../../vm/load.js";
import { ASProvider, useAS, type Store } from "../../vm/store.js";
import type { Account } from "../../vm/types.js";
import { sessionsPatch, SESSIONS_POLL_MS, useSessionsPoll } from "./sessions-poll.js";

const h = vi.hoisted(() => ({ rows: [] as unknown[], calls: 0, notes: [] as string[] }));
vi.mock("./bus.js", async (orig) => ({
  ...(await orig<typeof import("./bus.js")>()),
  notify: async (kind: string, title: string, message: string, opts?: { repeat?: boolean }) =>
    void h.notes.push(`${kind}|${title}|${message}${opts?.repeat ? "|repeat" : ""}`),
}));
vi.mock("../../ipc.js", async (orig) => ({
  ...(await orig<typeof import("../../ipc.js")>()),
  listSessions: async () => {
    h.calls++;
    return h.rows;
  },
}));

const NOW = 1_800_000_000_000;
const row = (id: string, profile: string, live: boolean, waiting = false, waitingFor = waiting ? "q1" : undefined): SessionRow =>
  ({ provider: "claude", sessionId: id, projectDir: "-x", cwd: "/x", summary: null, mtimeMs: NOW - 1000, birthtimeMs: NOW - 5000, live, waiting, waitingFor, file: "/f", profile, context: null }) as unknown as SessionRow;
const acc = (name: string, liveSessions: number) => ({ id: `claude:${name}`, tool: "claude", name, liveSessions }) as unknown as Account;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("sessions poll", () => {
  it("rebuilds the sessions and each account's running count from one read", () => {
    const p = sessionsPatch([acc("work", 0), acc("side", 2)], [row("a", "work", true), row("b", "work", false)], NOW);
    expect(p.sessions?.map((s) => [s.id, s.state])).toEqual([
      ["claude:a", "working"],
      ["claude:b", "done"],
    ]);
    expect(p.accounts?.map((a) => [a.name, a.liveSessions])).toEqual([
      ["work", 1],
      ["side", 0],
    ]);
  });

  it("picks up a session started since the last load within one poll", async () => {
    vi.useFakeTimers();
    let store: Store | null = null;
    function Host() {
      store = useAS();
      useSessionsPoll();
      return null;
    }
    render(
      <ASProvider initial={{ ...emptyViewModel(NOW), accounts: [acc("work", 0)] }}>
        <Host />
      </ASProvider>,
    );
    h.rows = [row("new", "work", true)];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SESSIONS_POLL_MS);
    });
    expect(store!.sessions.map((s) => s.id)).toEqual(["claude:new"]);
    expect(store!.accounts[0].liveSessions).toBe(1);
  });

  it("tells once when a session starts waiting on you — the pet and the bell pick it up", async () => {
    vi.useFakeTimers();
    h.notes = [];
    function Host() {
      useSessionsPoll();
      return null;
    }
    render(
      <ASProvider initial={{ ...emptyViewModel(NOW), accounts: [acc("work", 0)] }}>
        <Host />
      </ASProvider>,
    );
    h.rows = [row("old", "work", true, true)];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SESSIONS_POLL_MS); // first read: the starting point, nothing told
    });
    h.rows = [row("old", "work", true, true), row("new", "work", true, true)];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SESSIONS_POLL_MS);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SESSIONS_POLL_MS); // still waiting: not told again
    });
    // The same session asks again right away: a new question is a new moment.
    h.rows = [row("old", "work", true, true), row("new", "work", true, true, "q2")];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SESSIONS_POLL_MS);
    });
    expect(h.notes).toEqual([
      "warning|x is waiting for you|A session on work asks you something.|repeat",
      "warning|x is waiting for you|A session on work asks you something.|repeat",
    ]);
  });

  it("keeps watching with the window in the background, at half the pace", async () => {
    vi.useFakeTimers();
    const vis = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    try {
      h.calls = 0;
      function Host() {
        useSessionsPoll();
        return null;
      }
      render(
        <ASProvider initial={emptyViewModel(NOW)}>
          <Host />
        </ASProvider>,
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4 * SESSIONS_POLL_MS);
      });
      expect(h.calls).toBe(2);
    } finally {
      vis.mockRestore();
    }
  });
});
