import { describe, expect, it } from "vitest";
import { viewStep } from "./viewSwitch.js";

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
