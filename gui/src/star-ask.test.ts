import { beforeEach, describe, expect, it } from "vitest";
import {
  readStarAsk,
  recordStarAskShown,
  setStarAskStopped,
  shareLinks,
  STAR_ASK_FIRST_DELAY_MS,
  STAR_ASK_INTERVAL_MS,
  starAskDue,
  REPO_URL,
  REDDIT_POST_URL,
} from "./star-ask.js";

const DAY = 24 * 60 * 60_000;
const T0 = 1_800_000_000_000;

// jsdom's localStorage is an unreliable stub here (see settings-store.test.ts):
// a minimal in-memory Storage keeps the suite hermetic.
let mem: Pick<Storage, "getItem" | "setItem" | "removeItem" | "clear">;
beforeEach(() => {
  const map = new Map<string, string>();
  mem = {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
  };
  Object.defineProperty(globalThis, "localStorage", { value: mem, configurable: true });
});

describe("starAskDue", () => {
  it("waits the first delay after the app first ran", () => {
    const st = { firstSeen: T0, lastShown: null, stopped: null };
    expect(starAskDue(st, T0)).toBe(false);
    expect(starAskDue(st, T0 + STAR_ASK_FIRST_DELAY_MS - 1)).toBe(false);
    expect(starAskDue(st, T0 + STAR_ASK_FIRST_DELAY_MS)).toBe(true);
  });

  it("asks at most once per interval after it was shown", () => {
    const shown = T0 + 10 * DAY;
    const st = { firstSeen: T0, lastShown: shown, stopped: null };
    expect(starAskDue(st, shown + STAR_ASK_INTERVAL_MS - 1)).toBe(false);
    expect(starAskDue(st, shown + STAR_ASK_INTERVAL_MS)).toBe(true);
  });

  it.each(["starred", "off"] as const)("never asks again once stopped (%s)", (stopped) => {
    expect(starAskDue({ firstSeen: T0, lastShown: null, stopped }, T0 + 365 * DAY)).toBe(false);
  });
});

describe("star-ask storage", () => {
  it("stamps the first run on the first read and keeps it", () => {
    expect(readStarAsk(T0)).toEqual({ firstSeen: T0, lastShown: null, stopped: null });
    expect(readStarAsk(T0 + 5 * DAY).firstSeen).toBe(T0);
  });

  it("counts a showing and persists the stop", () => {
    readStarAsk(T0);
    expect(recordStarAskShown(T0 + 8 * DAY)).toBe(true);
    expect(starAskDue(readStarAsk(T0 + 9 * DAY), T0 + 9 * DAY)).toBe(false);
    setStarAskStopped("starred");
    expect(readStarAsk(T0 + 400 * DAY).stopped).toBe("starred");
  });

  it("treats unreadable state as fresh rather than crashing", () => {
    localStorage.setItem("agent-switch-star-ask", "{not json");
    expect(readStarAsk(T0)).toEqual({ firstSeen: T0, lastShown: null, stopped: null });
  });

  it("fails closed when the showing cannot be recorded", () => {
    mem.setItem = () => {
      throw new Error("blocked");
    };
    expect(recordStarAskShown(T0)).toBe(false);
  });
});

describe("shareLinks", () => {
  it("points every network at the repository, url-encoded", () => {
    const links = shareLinks();
    const enc = encodeURIComponent(REPO_URL);
    expect(links.map((l) => l.id)).toEqual(["reddit", "x", "linkedin", "facebook", "bluesky"]);
    expect(links.find((l) => l.id === "reddit")?.url).toBe(REDDIT_POST_URL);
    for (const l of links.filter((x) => x.id !== "reddit")) {
      expect(l.url.startsWith("https://")).toBe(true);
      expect(l.url).toContain(enc);
    }
  });
});
