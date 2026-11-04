import { beforeEach, describe, expect, it } from "vitest";
import { installMemoryStorage } from "../../redesign/engines/test-storage.js";
import type { NeedItem } from "../needs.js";
import { limitToOpen, markLimitOpened, openedLimits } from "./limit-auto.js";

const need = (over: Partial<NeedItem>): NeedItem => ({
  id: "n1",
  kind: "limit",
  subject: "claude/work",
  who: "work",
  what: "98% of 5h",
  verb: "Decide",
  since: "2026-11-04T08:00:00Z",
  version: "five_hour:2026-11-04T13:00:00Z",
  ...over,
});

describe("limit auto-open", () => {
  beforeEach(() => installMemoryStorage());

  it("opens the first limit with a session to move, once per item version", () => {
    const hasSessions = (s: string) => s !== "codex/idle";
    const needs = [need({ id: "q", kind: "question", subject: "claude/x/1" }), need({ id: "a", subject: "codex/idle" }), need({ id: "b", subject: "claude/work" })];
    expect(limitToOpen(needs, new Set(), hasSessions)?.id).toBe("b");
    expect(limitToOpen(needs, new Set(["b@five_hour:2026-11-04T13:00:00Z"]), hasSessions)).toBeNull();
    expect(limitToOpen([need({ id: "b", version: "five_hour:2026-11-04T18:00:00Z" })], new Set(["b@five_hour:2026-11-04T13:00:00Z"]), hasSessions)?.id).toBe("b");
  });

  it("remembers what it opened across reloads, and survives a broken store", () => {
    markLimitOpened(need({ id: "b" }));
    expect(openedLimits().has("b@five_hour:2026-11-04T13:00:00Z")).toBe(true);
    Object.defineProperty(globalThis, "localStorage", { value: { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); } }, configurable: true });
    expect(openedLimits().size).toBe(0);
    expect(() => markLimitOpened(need({ id: "c" }))).not.toThrow();
  });
});
