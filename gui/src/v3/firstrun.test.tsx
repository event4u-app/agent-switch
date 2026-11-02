import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FirstRun, addAllLabel } from "./firstrun.js";

afterEach(cleanup);
const on = () => ({ add: vi.fn(), install: vi.fn(), addAll: vi.fn(), addAnother: vi.fn(), applyShell: vi.fn(), done: vi.fn() });
const tools = [
  { id: "claude", name: "Claude Code", detail: "~/.claude · signed in", signedIn: true, installed: true },
  { id: "codex", name: "Codex", detail: "~/.codex · signed in", signedIn: true, installed: true },
  { id: "antigravity", name: "Antigravity", detail: "not installed", signedIn: false, installed: false },
];

describe("first run (spec §10.6)", () => {
  it("one path: the detected tools, add the signed-in ones, then the shell lines before anything changes", () => {
    const h = on();
    render(<FirstRun tools={tools} shell={{ file: "~/.zshrc", lines: ['eval "$(agent-switch shellenv --shell zsh)"'] }} on={h} />);
    expect(screen.getAllByText("Add as “work”")).toHaveLength(2);
    fireEvent.click(screen.getByText("Install…"));
    expect(h.install).toHaveBeenCalledWith("antigravity");
    fireEvent.click(screen.getByText("Add both and continue"));
    expect(h.addAll).toHaveBeenCalledWith(["claude", "codex"]);
    expect(h.applyShell).not.toHaveBeenCalled();
    expect(screen.getByText('eval "$(agent-switch shellenv --shell zsh)"')).toBeTruthy();
    fireEvent.click(screen.getByText("Not now"));
    expect(h.applyShell).not.toHaveBeenCalled();
    expect(h.done).toHaveBeenCalledOnce();
  });

  it("the primary names how many it adds; with none signed in it waits", () => {
    expect([1, 2, 3].map(addAllLabel)).toEqual(["Add and continue", "Add both and continue", "Add all 3 and continue"]);
    render(<FirstRun tools={[{ ...tools[0], signedIn: false }]} shell={{ file: "~/.zshrc", lines: [] }} on={on()} />);
    expect((screen.getByText("Add and continue").closest("button") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Sign in…")).toBeTruthy();
  });
});
