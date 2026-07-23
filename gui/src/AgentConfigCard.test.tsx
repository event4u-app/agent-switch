import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import {
  AgentConfigCard,
  AGENT_CONFIG_INSTALL_COMMAND,
  AGENT_CONFIG_UPDATE_COMMAND,
} from "./AgentConfigCard.js";

const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);

beforeEach(() => {
  cleanup();
  writeText.mockClear().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});
afterEach(() => vi.useRealTimers());

function setup(over: Partial<Parameters<typeof AgentConfigCard>[0]> = {}) {
  const props = {
    view: { visible: true as const, mode: "install" as const },
    variant: "ecosystem" as const,
    devMode: false,
    isWindows: false,
    onOpenRepo: vi.fn(),
    onDismiss: vi.fn(),
    onNotifyError: vi.fn(),
    ...over,
  };
  render(<AgentConfigCard {...props} />);
  return props;
}

describe("AgentConfigCard", () => {
  it("install mode shows the promo, the command, and copies it — never runs anything", async () => {
    setup();
    expect(screen.getByText(/supercharge your ai agents/i)).toBeTruthy();
    expect(screen.getByText(AGENT_CONFIG_INSTALL_COMMAND)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /copy install command/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(AGENT_CONFIG_INSTALL_COMMAND));
    expect(await screen.findByRole("button", { name: /copied/i })).toBeTruthy();
  });

  it("update mode shows current → latest and copies the update command", async () => {
    setup({ view: { visible: true, mode: "update", current: "9.1.0", latest: "9.2.0" } });
    expect(screen.getByText(/v9\.1\.0.*v9\.2\.0/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /copy update command/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(AGENT_CONFIG_UPDATE_COMMAND));
  });

  it("a clipboard failure routes to the notification system ONLY (never inline)", async () => {
    writeText.mockRejectedValue(new Error("clipboard blocked"));
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: /copy install command/i }));
    await waitFor(() => expect(p.onNotifyError).toHaveBeenCalledWith("clipboard blocked"));
    expect(screen.queryByText(/clipboard blocked/)).toBeNull();
  });

  it("shows the EACCES note on macOS/Linux and hides it on Windows", () => {
    setup({ isWindows: false });
    expect(screen.getByText(/EACCES/)).toBeTruthy();
    cleanup();
    setup({ isWindows: true });
    expect(screen.queryByText(/EACCES/)).toBeNull();
  });

  it("clicking the card body opens the repo; the copy button does not", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: /copy install command/i }));
    expect(p.onOpenRepo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTitle(/open the agent-config repository/i));
    expect(p.onOpenRepo).toHaveBeenCalled();
  });

  it("first-run variant carries a dismiss control; ecosystem variant does not", () => {
    const p = setup({ variant: "first-run" });
    fireEvent.click(screen.getByRole("button", { name: /dismiss agent-config recommendation/i }));
    expect(p.onDismiss).toHaveBeenCalled();
    cleanup();
    setup({ variant: "ecosystem" });
    expect(screen.queryByRole("button", { name: /dismiss agent-config recommendation/i })).toBeNull();
  });

  it("installed mode shows both versions and no copy action", () => {
    setup({ view: { visible: true, mode: "installed", current: "9.2.0", latest: "9.2.0" }, devMode: true });
    expect(screen.getByText(/installed v9\.2\.0.*latest is v9\.2\.0/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /copy/i })).toBeNull();
  });

  it("dev preview toggle cycles exactly the 3 states, no duplicate", () => {
    setup({ view: { visible: true, mode: "installed", current: "9.2.0", latest: "9.2.0" }, devMode: true });
    const toggle = screen.getByRole("button", { name: /cycle card preview/i });
    expect(screen.getByText(/agent-config is up to date/i)).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.getByText(/supercharge your ai agents/i)).toBeTruthy(); // install
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: /copy update command/i })).toBeTruthy(); // update
    fireEvent.click(toggle);
    expect(screen.getByText(/agent-config is up to date/i)).toBeTruthy(); // full loop
  });

  it("dev Test-error button routes to the notification system only", () => {
    const p = setup({ devMode: true });
    fireEvent.click(screen.getByRole("button", { name: /test error/i }));
    expect(p.onNotifyError).toHaveBeenCalledWith(expect.stringMatching(/simulated agent-config failure/i));
    expect(screen.queryByText(/simulated agent-config failure/i)).toBeNull();
  });
});
