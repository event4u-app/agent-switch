import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  getPetBubbleDuration,
  getPetBubbles,
  getPetChoice,
  getPetEnabled,
  getPetLabel,
  getPetMotion,
  getPetPos,
  getPetPosLock,
  getPetPresence,
  getPetPrevPos,
  getPetReactKinds,
  getPetSize,
  getPetTier,
  getPetWelcomed,
} from "./settings-store.js";

// The desktop pet's settings as 2.1.0's window left them in localStorage, every
// value away from its default so a reader that falls back to one is caught.
const STORED: Record<string, string> = JSON.parse(readFileSync(resolve(__dirname, "../../tests/fixtures/upgrade-2.1.0/gui-local-storage.json"), "utf8"));

describe("the desktop pet's settings from 2.1.0", () => {
  beforeEach(() => {
    // jsdom's localStorage is not usable here; an in-memory Storage holds the stored values.
    const map = new Map<string, string>(Object.entries(STORED));
    const mem: Pick<Storage, "getItem" | "setItem" | "removeItem" | "clear"> = {
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => void map.set(k, String(v)),
      removeItem: (k) => void map.delete(k),
      clear: () => map.clear(),
    };
    Object.defineProperty(globalThis, "localStorage", { value: mem, configurable: true });
  });

  it("the pet stays off when 2.1.0 turned it off", () => {
    expect(getPetEnabled()).toBe(false);
  });

  it("every other pet setting reads as 2.1.0 wrote it", () => {
    expect({
      presence: getPetPresence(),
      welcomed: getPetWelcomed(),
      choice: getPetChoice(),
      tier: getPetTier(),
      kinds: getPetReactKinds(),
      bubbles: getPetBubbles(),
      duration: getPetBubbleDuration(),
      size: getPetSize(),
      motion: getPetMotion(),
      label: getPetLabel(),
      pos: getPetPos(),
      lock: getPetPosLock(),
      prev: getPetPrevPos(),
    }).toEqual({
      presence: "always",
      welcomed: true,
      choice: "dev-bot",
      tier: "pet-only",
      kinds: ["error", "warning"],
      bubbles: false,
      duration: "long",
      size: "large",
      motion: "off",
      label: true,
      pos: { x: 1210, y: 640 },
      lock: true,
      prev: { x: 40, y: 60 },
    });
  });

  it("reading changes nothing that was stored", () => {
    getPetEnabled();
    getPetPos();
    getPetReactKinds();
    for (const [k, v] of Object.entries(STORED)) expect(localStorage.getItem(k)).toBe(v);
  });
});
