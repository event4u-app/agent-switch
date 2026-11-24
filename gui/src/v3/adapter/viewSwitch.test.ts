import { describe, expect, it } from "vitest";
import { afterChatClosed, loadOwnViews, OWN_VIEWS_MAX, rememberOwnView, ResumeGate, resumesChat, viewStep } from "./viewSwitch.js";

const base = { inChat: false, hosted: true, chatRunning: false, terminalRunning: false };

describe("viewStep", () => {
  it("to chat: between turns it opens the chat; during a terminal turn it arms; already there, nothing", () => {
    expect(viewStep("chat", base)).toEqual({ do: "open-chat" });
    expect(viewStep("chat", { ...base, terminalRunning: true })).toEqual({ do: "arm", to: "chat" });
    expect(viewStep("chat", { ...base, inChat: true })).toEqual({ do: "none" });
  });
  it("to terminal: closing the chat brings the terminal back; during a chat turn it arms; a chat-born session has no terminal", () => {
    const chat = { ...base, inChat: true };
    expect(viewStep("terminal", chat)).toEqual({ do: "close-chat" });
    expect(viewStep("terminal", { ...chat, chatRunning: true })).toEqual({ do: "arm", to: "terminal" });
    expect(viewStep("terminal", { ...chat, hosted: false })).toEqual({ do: "no-terminal" });
    expect(viewStep("terminal", base)).toEqual({ do: "none" });
    expect(viewStep("terminal", { ...base, hosted: true, parked: true })).toEqual({ do: "restore" });
    expect(viewStep("terminal", { ...base, hosted: true })).toEqual({ do: "none" });
  });
});

describe("view memory", () => {
  it("a parked hosted session with no chat in this window opens its chat again; otherwise nothing", () => {
    expect(resumesChat({ inChat: false, hosted: true, parked: true })).toBe(true);
    expect(resumesChat({ inChat: true, hosted: true, parked: true })).toBe(false);
    expect(resumesChat({ inChat: false, hosted: true, parked: false })).toBe(false);
    expect(resumesChat({ inChat: false, hosted: false, parked: true })).toBe(false);
  });
  it("own-terminal views survive a reload; unreadable memory is none; the newest choice wins and the list is capped", () => {
    expect(loadOwnViews(null).size).toBe(0);
    expect(loadOwnViews("{not json").size).toBe(0);
    expect(loadOwnViews(JSON.stringify({ a: "chat" })).size).toBe(0);
    let m = rememberOwnView(new Map(), "claude/w/a", "terminal");
    m = rememberOwnView(m, "claude/w/b", "chat");
    m = rememberOwnView(m, "claude/w/a", "chat");
    const back = loadOwnViews(JSON.stringify([...m, ["claude/w/c", "bogus"], [1, "chat"]]));
    expect([...back]).toEqual([["claude/w/b", "chat"], ["claude/w/a", "chat"]]);
    for (let i = 0; i < OWN_VIEWS_MAX + 5; i++) m = rememberOwnView(m, `k${i}`, "terminal");
    expect(m.size).toBe(OWN_VIEWS_MAX);
    expect(m.has("k0")).toBe(false);
    expect(m.has(`k${OWN_VIEWS_MAX + 4}`)).toBe(true);
  });
});

describe("ResumeGate", () => {
  it("brings the chat back once per opening; never right after the person chose the terminal; again after a failure or a chosen chat", () => {
    const g = new ResumeGate();
    expect(g.take("k")).toBe(true);
    expect(g.take("k")).toBe(false);
    g.failed("k");
    expect(g.take("k"), "a failed try is tried again when the session is opened again").toBe(true);
    g.chose("k", "chat");
    expect(g.take("k"), "a chat the person had open ended by itself: it comes back").toBe(true);
    g.chose("k", "terminal");
    expect(g.take("k"), "the tab closed for the terminal while the window still reads parked: no reopening").toBe(false);
    expect(g.take("other"), "per session").toBe(true);
  });
  it("a while after closing for the terminal: restore only if the window still waits and no chat was opened again", () => {
    expect(afterChatClosed({ chatOpen: false, parked: true })).toBe("restore");
    expect(afterChatClosed({ chatOpen: true, parked: true })).toBe("refresh");
    expect(afterChatClosed({ chatOpen: false, parked: false })).toBe("refresh");
  });
});
