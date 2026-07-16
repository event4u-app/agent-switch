import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { AgentConfigBanner } from "./AgentConfigBanner.js";

beforeEach(() => cleanup());

function setup(over: Partial<Parameters<typeof AgentConfigBanner>[0]> = {}) {
  const props = {
    view: { visible: true as const, mode: "install" as const },
    devMode: false,
    onOpenRepo: vi.fn(),
    onInstall: vi.fn().mockResolvedValue(undefined),
    onUpdate: vi.fn().mockResolvedValue(undefined),
    onSuccess: vi.fn(),
    onNotifyError: vi.fn(),
    ...over,
  };
  render(<AgentConfigBanner {...props} />);
  return props;
}

describe("AgentConfigBanner", () => {
  it("renders the install promo and, on a successful install, calls onSuccess (parent hides it)", async () => {
    const p = setup();
    expect(screen.getByText(/supercharge your ai agents/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /install/i }));
    await waitFor(() => expect(p.onInstall).toHaveBeenCalled());
    await waitFor(() => expect(p.onSuccess).toHaveBeenCalled());
    expect(p.onNotifyError).not.toHaveBeenCalled();
  });

  it("shows the current → latest versions in update mode and runs the upgrade", async () => {
    const p = setup({ view: { visible: true, mode: "update", current: "9.1.0", latest: "9.2.0" } });
    expect(screen.getByText(/v9\.1\.0.*v9\.2\.0/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /update to v9\.2\.0/i }));
    await waitFor(() => expect(p.onUpdate).toHaveBeenCalled());
    await waitFor(() => expect(p.onSuccess).toHaveBeenCalled());
  });

  it("on failure routes the error to the notification system ONLY (never inline) and does NOT hide", async () => {
    const p = setup({ onInstall: vi.fn().mockRejectedValue(new Error("npx blew up")) });
    fireEvent.click(screen.getByRole("button", { name: /install/i }));
    await waitFor(() => expect(p.onNotifyError).toHaveBeenCalledWith("npx blew up"));
    expect(screen.queryByText(/npx blew up/)).toBeNull(); // nothing shown below the banner
    expect(p.onSuccess).not.toHaveBeenCalled();
  });

  it("clicking the banner body opens the repo; clicking the action button does not", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: /install/i }));
    expect(p.onOpenRepo).not.toHaveBeenCalled(); // button click is not a banner click
    fireEvent.click(screen.getByTitle(/open the agent-config repository/i));
    expect(p.onOpenRepo).toHaveBeenCalled();
  });

  it("dev Test-error button routes the error to the notification system only (nothing inline, nothing run)", () => {
    const p = setup({ devMode: true });
    fireEvent.click(screen.getByRole("button", { name: /test error/i }));
    expect(p.onNotifyError).toHaveBeenCalledWith(expect.stringMatching(/simulated agent-config failure/i));
    expect(screen.queryByText(/simulated agent-config failure/i)).toBeNull(); // notification only
    expect(p.onInstall).not.toHaveBeenCalled();
  });

  it("dev preview toggle cycles exactly the 3 states (up-to-date → install → update → up-to-date), no duplicate", () => {
    setup({ view: { visible: true, mode: "installed", current: "9.2.0", latest: "9.2.0" }, devMode: true });
    const toggle = screen.getByRole("button", { name: /cycle banner preview/i });
    // starts on the real state (installed = up to date)
    expect(screen.getByText(/agent-config is up to date/i)).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.getByText(/supercharge your ai agents/i)).toBeTruthy(); // install
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: /update to v9\.2\.0/i })).toBeTruthy(); // update
    fireEvent.click(toggle);
    expect(screen.getByText(/agent-config is up to date/i)).toBeTruthy(); // one full loop, back to up-to-date
  });

  it("installed mode (dev only) shows BOTH versions clearly and no primary action", () => {
    setup({ view: { visible: true, mode: "installed", current: "9.2.0", latest: "9.2.0" }, devMode: true });
    // Must show installed AND latest version, even when up to date.
    expect(screen.getByText(/installed v9\.2\.0.*latest is v9\.2\.0/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^install$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /update to/i })).toBeNull();
  });
});
