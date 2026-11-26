import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { DeliberationChip, DeliberationSettings } from "./deliberation.js";
import { DeliberationChipSlot, DeliberationGlobalSlot } from "./adapter/deliberation.js";
import { StatusBar } from "./workbench.js";

afterEach(cleanup);

describe("council, arena, panel: global setting and one chat's control (owner, 2026-11-26)", () => {
  it("Settings › Agents: off by default until turned on; Off, Offer, Auto say what they do", () => {
    const onChange = vi.fn();
    const { rerender } = render(<DeliberationSettings state={{ mode: "off", source: "default" }} onChange={onChange} />);
    expect(screen.getByText(/The default: never offered/)).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Off" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "Auto" }));
    expect(onChange).toHaveBeenCalledWith("auto");
    rerender(<DeliberationSettings state={{ mode: "offer", source: "global" }} onChange={onChange} />);
    expect(screen.getByText(/offers the fitting council, arena or panel/)).toBeTruthy();
  });

  it("when agent-config cannot answer, the setting says why and stays off", () => {
    render(<DeliberationSettings state={null} error="unknown command deliberation:get" onChange={() => {}} />);
    expect(screen.getByText(/Not available: unknown command/)).toBeTruthy();
    expect((screen.getByRole("radio", { name: "Auto" }) as HTMLButtonElement).getAttribute("aria-disabled") ?? (screen.getByRole("radio", { name: "Auto" }) as HTMLButtonElement).disabled.toString()).toMatch(/true/);
  });

  it("the chat's chip shows its mode, marks its own choice, and goes back to the global one", () => {
    const onChange = vi.fn();
    render(<DeliberationChip state={{ mode: "auto", source: "session" }} global="offer" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Council, arena, panel: Auto for this chat/ }));
    fireEvent.click(screen.getByText("Same as global (Offer)"));
    expect(onChange).toHaveBeenCalledWith("inherit");
  });

  it("the slot reads the chat's mode and the global one, and writes the chat's choice with its key", async () => {
    const read = vi.fn(async (key?: string) => (key ? { mode: "offer" as const, source: "global" as const } : { mode: "offer" as const, source: "global" as const }));
    const write = vi.fn(async (mode: string, key?: string) => ({ mode: mode as "off", source: key ? ("session" as const) : ("global" as const) }));
    render(<StatusBar place={{ cwd: "/Users/me/code/app", project: "app", branch: "main" }} extra={<DeliberationChipSlot sessionKey="claude/me/s1" read={read} write={write} />} />);
    fireEvent.click(await screen.findByRole("button", { name: /Council, arena, panel: Offer/ }));
    fireEvent.click(screen.getByText("Off"));
    await waitFor(() => expect(write).toHaveBeenCalledWith("off", "claude/me/s1"));
    expect(await screen.findByRole("button", { name: /Council, arena, panel: Off for this chat/ })).toBeTruthy();
  });

  it("no agent-config answer: the status bar shows no chip; the global slot writes without a key", async () => {
    const failing = vi.fn(async () => Promise.reject(new Error("agent-config: unknown command")));
    render(<StatusBar place={{ cwd: "/x", project: "x", branch: null }} extra={<DeliberationChipSlot sessionKey="k" read={failing} />} />);
    await waitFor(() => expect(failing).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /Council, arena, panel/ })).toBeNull();
    cleanup();
    const write = vi.fn(async () => ({ mode: "auto" as const, source: "global" as const }));
    render(<DeliberationGlobalSlot read={async () => ({ mode: "offer", source: "default" })} write={write} />);
    fireEvent.click(await screen.findByRole("radio", { name: "Auto" }));
    await waitFor(() => expect(write).toHaveBeenCalledWith("auto", undefined));
  });
});
