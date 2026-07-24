import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { AgentConfigCard } from "./AgentConfigCard.js";

beforeEach(() => cleanup());

function setup(over: Partial<Parameters<typeof AgentConfigCard>[0]> = {}) {
  const props = {
    view: { visible: true as const, mode: "install" as const },
    variant: "ecosystem" as const,
    devMode: false,
    onOpenRepo: vi.fn(),
    onRun: vi.fn<(action: "install" | "upgrade") => Promise<void>>().mockResolvedValue(undefined),
    onDismiss: vi.fn(),
    onNotifyError: vi.fn(),
    ...over,
  };
  render(<AgentConfigCard {...props} />);
  return props;
}

describe("AgentConfigCard", () => {
  it("install mode shows the promo and a one-click Install that runs in the background", async () => {
    const p = setup();
    expect(screen.getByText(/supercharge your ai agents/i)).toBeTruthy();
    // One-click only — no copy-command affordance and no EACCES footnote remain.
    expect(screen.queryByRole("button", { name: /copy/i })).toBeNull();
    expect(screen.queryByText(/EACCES/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^install$/i }));
    await waitFor(() => expect(p.onRun).toHaveBeenCalledWith("install"));
  });

  it("update mode shows current → latest and a version-naming one-click Update", async () => {
    const p = setup({ view: { visible: true, mode: "update", current: "9.1.0", latest: "9.2.0" } });
    expect(screen.getByText(/v9\.1\.0.*v9\.2\.0/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Update to v9.2.0" }));
    await waitFor(() => expect(p.onRun).toHaveBeenCalledWith("upgrade"));
  });

  it("shows a disabled busy label while the run is pending and restores it after", async () => {
    let resolve!: () => void;
    const onRun = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    setup({ onRun });
    const btn = screen.getByRole("button", { name: /^install$/i });
    fireEvent.click(btn);
    const busyBtn = await screen.findByRole("button", { name: "Installing…" });
    expect((busyBtn as HTMLButtonElement).disabled).toBe(true);
    resolve();
    expect(await screen.findByRole("button", { name: /^install$/i })).toBeTruthy();
  });

  it("update mode busy label reads Updating…", async () => {
    let resolve!: () => void;
    const onRun = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    setup({ view: { visible: true, mode: "update", current: "9.1.0", latest: "9.2.0" }, onRun });
    fireEvent.click(screen.getByRole("button", { name: "Update to v9.2.0" }));
    expect(await screen.findByRole("button", { name: "Updating…" })).toBeTruthy();
    resolve();
    expect(await screen.findByRole("button", { name: "Update to v9.2.0" })).toBeTruthy();
  });

  it("clicking the card body opens the repo; the action button does not", async () => {
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: /^install$/i }));
    expect(p.onOpenRepo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTitle(/open the agent-config repository/i));
    expect(p.onOpenRepo).toHaveBeenCalled();
    await waitFor(() => expect(p.onRun).toHaveBeenCalled()); // settle the pending run
  });

  it("first-run variant carries a dismiss control; ecosystem variant does not", () => {
    const p = setup({ variant: "first-run" });
    fireEvent.click(screen.getByRole("button", { name: /dismiss agent-config recommendation/i }));
    expect(p.onDismiss).toHaveBeenCalled();
    cleanup();
    setup({ variant: "ecosystem" });
    expect(screen.queryByRole("button", { name: /dismiss agent-config recommendation/i })).toBeNull();
  });

  it("installed mode shows both versions and no action button", () => {
    setup({ view: { visible: true, mode: "installed", current: "9.2.0", latest: "9.2.0" }, devMode: true });
    expect(screen.getByText(/installed v9\.2\.0.*latest is v9\.2\.0/i)).toBeTruthy();
    // No action button — the card-body repo button ("agent-config is up to
    // date…") is the only match candidate, hence the anchored patterns.
    expect(screen.queryByRole("button", { name: /^install$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^update to/i })).toBeNull();
  });

  it("dev preview toggle cycles exactly the 3 states, no duplicate", () => {
    setup({ view: { visible: true, mode: "installed", current: "9.2.0", latest: "9.2.0" }, devMode: true });
    const toggle = screen.getByRole("button", { name: /cycle card preview/i });
    expect(screen.getByText(/agent-config is up to date/i)).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.getByText(/supercharge your ai agents/i)).toBeTruthy(); // install
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Update to v9.2.0" })).toBeTruthy(); // update
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
