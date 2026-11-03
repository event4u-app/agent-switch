import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { noticeFor, useChats } from "./chats.js";
import type { BridgeDeps } from "./useBridge.js";

afterEach(cleanup);

describe("noticeFor", () => {
  it("approvals, questions and finished turns; nothing else", () => {
    expect(noticeFor({ t: "approval.requested", id: "r", tool: "Bash", summary: "npm test", input: {} }, "Store")).toEqual({ kind: "warning", title: "Store needs your approval", message: "Bash npm test" });
    expect(noticeFor({ t: "question.requested", id: "q", questions: [{ question: "Which?", options: [] }] }, "Store")?.message).toBe("Which?");
    expect(noticeFor({ t: "turn.end", ok: true, durationMs: 1, costUsd: null }, "Store")?.kind).toBe("success");
    expect(noticeFor({ t: "turn.end", ok: false, durationMs: 1, costUsd: null }, "Store")).toBeNull();
    expect(noticeFor({ t: "message.delta", id: "m", text: "x" }, "Store")).toBeNull();
  });
});

describe("useChats", () => {
  it("runs a chat's bridge outside its tab, follows a new chat to its session key, notifies only while hidden", async () => {
    let emit: (o: object) => void = () => {};
    const deps: BridgeDeps = {
      history: async () => [],
      open: async (_s, onLine) => {
        emit = (o) => onLine(JSON.stringify(o));
        return { send: async () => {}, kill: async () => {} };
      },
    };
    const notify = vi.fn();
    let chats: ReturnType<typeof useChats> | null = null;
    function Host() {
      chats = useChats(() => "Store", deps, notify);
      return (
        <>
          <p>{`${[...chats.keys].join(",")} | ${chats.tabOf("claude/w/real") ?? "-"}`}</p>
          {chats.runners}
        </>
      );
    }
    render(<Host />);
    act(() => chats!.open("claude/w/chat-1", { new: { profile: "w", provider: "claude", cwd: "/r" }, mode: "default" }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    act(() => {
      emit({ bridge: "ready", key: "claude/w/new", mode: "default" });
      emit({ bridge: "session", key: "claude/w/real", model: null, mode: null, commands: [] });
    });
    expect(screen.getByText("claude/w/chat-1,claude/w/real | claude/w/chat-1")).toBeTruthy();
    act(() => emit({ event: { t: "approval.requested", id: "r", tool: "Bash", summary: "ls", input: {} } }));
    expect(notify).not.toHaveBeenCalled();
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    act(() => emit({ event: { t: "turn.end", ok: true, durationMs: 1, costUsd: null } }));
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    expect(notify).toHaveBeenCalledWith("success", "Store is done", "The turn ended.");
    act(() => chats!.close("claude/w/chat-1"));
    expect(screen.getByText("| -")).toBeTruthy();
  });
});
