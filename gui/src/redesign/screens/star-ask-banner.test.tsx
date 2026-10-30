import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const shellOpen = vi.fn((_url: string) => Promise.resolve());
vi.mock("@tauri-apps/plugin-shell", () => ({ open: (url: string) => shellOpen(url) }));

import { readStarAsk, REDDIT_POST_URL, REPO_URL, STAR_ASK_FIRST_DELAY_MS } from "../../star-ask.js";
import { StarAskBanner } from "./star-ask-banner.js";

const KEY = "agent-switch-star-ask";
let map: Map<string, string>;

beforeEach(() => {
  map = new Map();
  const mem: Pick<Storage, "getItem" | "setItem" | "removeItem" | "clear"> = {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
  };
  Object.defineProperty(globalThis, "localStorage", { value: mem, configurable: true });
  shellOpen.mockClear();
});
afterEach(cleanup);

function seedDue() {
  map.set(KEY, JSON.stringify({ firstSeen: Date.now() - STAR_ASK_FIRST_DELAY_MS - 1000, lastShown: null, stopped: null }));
}

describe("StarAskBanner", () => {
  it("stays hidden on a fresh install", () => {
    render(<StarAskBanner />);
    expect(screen.queryByText(/Give it a star/)).toBeNull();
  });

  it("asks once it is due, and counts the showing so the next launch does not", () => {
    seedDue();
    render(<StarAskBanner />);
    expect(screen.getByText(/Give it a star on GitHub/)).toBeTruthy();
    expect(readStarAsk(Date.now()).lastShown).not.toBeNull();
    cleanup();
    render(<StarAskBanner />);
    expect(screen.queryByText(/Give it a star/)).toBeNull();
  });

  it("opens the repo on Star, stops for good and offers sharing", () => {
    seedDue();
    render(<StarAskBanner />);
    fireEvent.click(screen.getByRole("button", { name: /Star on GitHub/ }));
    expect(shellOpen).toHaveBeenCalledWith(REPO_URL);
    expect(readStarAsk(Date.now()).stopped).toBe("starred");
    expect(screen.getByText("Thank you for the star!")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open the Reddit post" }));
    expect(shellOpen).toHaveBeenCalledWith(REDDIT_POST_URL);
  });

  it("stops for good on Don't ask again, without recording a star", () => {
    seedDue();
    render(<StarAskBanner />);
    fireEvent.click(screen.getByRole("button", { name: "Don't ask again" }));
    expect(screen.queryByText(/Give it a star/)).toBeNull();
    expect(readStarAsk(Date.now()).stopped).toBe("off");
  });

  it("toggles the share section without stopping the ask", () => {
    seedDue();
    render(<StarAskBanner />);
    expect(screen.queryByText(/r\/ClaudeCode/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Share/ }));
    expect(screen.getByText(/r\/ClaudeCode/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "LinkedIn" }));
    expect(shellOpen.mock.calls.at(-1)?.[0]).toContain("linkedin.com");
    expect(readStarAsk(Date.now()).stopped).toBeNull();
  });
});
