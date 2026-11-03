import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import fx from "./fixtures/timeline-claude-2.1.316.json";
import { ChatView } from "./chatview.js";
import type { Chat } from "./adapter/chats.js";
import type { AsEvent } from "./timeline.js";

afterEach(cleanup);

function chat(over: Partial<Chat> = {}): Chat {
  return {
    events: fx.stream as AsEvent[],
    status: "ready",
    error: null,
    queued: 0,
    mode: "default",
    session: { key: "claude/w/s", model: "claude-haiku-5-5", commands: ["compact"] },
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

describe("ChatView", () => {
  it("header: model, mode, the last turn and what it cost; the approval card answers through the bridge", () => {
    const c = chat();
    render(<ChatView b={c} />);
    expect(screen.getByText("claude-haiku-5-5")).toBeTruthy();
    expect(screen.getAllByText("Ask before edits").length).toBeGreaterThan(0);
    expect(screen.getByText(/^last turn \d+ s$/)).toBeTruthy();
    expect(screen.getByText(/^\$0\.004$/)).toBeTruthy();
    fireEvent.click(screen.getByText("Allow once"));
    expect(c.approve).toHaveBeenCalledWith(expect.any(String), false);
  });

  it("a question is answered with the picked option", () => {
    const c = chat({ events: [{ t: "question.requested", id: "q1", questions: [{ question: "Colour?", options: ["Red", "Blue"] }] }] });
    render(<ChatView b={c} />);
    fireEvent.click(screen.getByText("Blue"));
    expect(c.answer).toHaveBeenCalledWith("q1", { "Colour?": "Blue" });
  });

  it("while starting nothing can be sent; an error and an ended chat say so; nothing is answerable then", () => {
    const { unmount } = render(<ChatView b={chat({ status: "starting", events: [] })} />);
    expect(screen.getByText("Connecting…")).toBeTruthy();
    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).disabled).toBe(true);
    unmount();
    const e = render(<ChatView b={chat({ status: "error", error: "spawn ENOENT" })} />);
    expect(screen.getByRole("alert").textContent).toContain("spawn ENOENT");
    expect(screen.queryByText("Allow once")).toBeNull();
    e.unmount();
    render(<ChatView b={chat({ status: "closed" })} />);
    expect(screen.getByText(/The chat ended/)).toBeTruthy();
  });

  it("Codex: ⌥↵ during a turn steers it; Claude has no steering", () => {
    const running = [{ t: "turn", id: "u", at: null }, { t: "message", id: "u", role: "user", text: "go", images: 0 }] as AsEvent[];
    const c = chat({ events: running, session: { key: "codex/w/t", model: "gpt", commands: [] } });
    const { unmount } = render(<ChatView b={c} />);
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "also check x" } });
    fireEvent.keyDown(screen.getByLabelText("Message"), { key: "Enter", altKey: true });
    expect(c.steer).toHaveBeenCalledWith("also check x");
    expect(c.send).not.toHaveBeenCalled();
    unmount();
    const k = chat({ events: running });
    render(<ChatView b={k} />);
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "later" } });
    fireEvent.keyDown(screen.getByLabelText("Message"), { key: "Enter", altKey: true });
    expect(k.steer).not.toHaveBeenCalled();
    expect(k.send).toHaveBeenCalledWith("later", []);
  });

  it("the composer sends through the bridge and Stop interrupts while a turn runs", () => {
    const c = chat({ events: [{ t: "turn", id: "u", at: null }, { t: "message", id: "u", role: "user", text: "go", images: 0 }] });
    render(<ChatView b={c} />);
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "more" } });
    fireEvent.keyDown(screen.getByLabelText("Message"), { key: "Enter" });
    expect(c.send).toHaveBeenCalledWith("more", []);
    fireEvent.click(screen.getByText("Stop"));
    expect(c.interrupt).toHaveBeenCalled();
  });
});
