import { describe, expect, it } from "vitest";
import {
  KIND_TO_REACTION,
  PET_IDS,
  ROWS,
  asPetId,
  bubbleAction,
  contextMood,
  decidePetRouting,
  isSwitchSuggestion,
  sanitizeBubble,
} from "./model.js";

describe("pet model", () => {
  it("maps every notification kind to a real spritesheet row", () => {
    for (const reaction of Object.values(KIND_TO_REACTION)) {
      expect(ROWS[reaction]).toBeDefined();
    }
  });

  it("keeps the row map consistent with the 8x9 sheet contract", () => {
    const rows = Object.values(ROWS).map((r) => r.row);
    expect(new Set(rows).size).toBe(rows.length); // one reaction per row
    for (const r of Object.values(ROWS)) {
      expect(r.row).toBeGreaterThanOrEqual(0);
      expect(r.row).toBeLessThan(9);
      expect(r.frames).toBeGreaterThan(0);
      expect(r.frames).toBeLessThanOrEqual(8);
      expect(r.durationMs).toBeGreaterThan(0);
    }
  });

  it("detects the daemon's switch-suggestion message", () => {
    expect(isSwitchSuggestion("claude/work hit ≥80% — suggested profile: claude/private. Run `agent-switch rebind`.")).toBe(true);
    expect(isSwitchSuggestion("Could not fetch usage limits for claude/work.")).toBe(false);
  });

  it("sanitizes bubble text to one capped line", () => {
    expect(sanitizeBubble("a\nb\tc")).toBe("a b c");
    expect(sanitizeBubble("  spaced   out  ")).toBe("spaced out");
    const long = "x".repeat(200);
    expect(sanitizeBubble(long).length).toBe(140);
    expect(sanitizeBubble(long).endsWith("…")).toBe(true);
  });

  describe("decidePetRouting", () => {
    const base = { petEnabled: true, tier: "hybrid" as const, petKinds: ["success", "error"] as const, osNotified: false };

    it("routes an enabled kind to the pet in hybrid without suppressing desktop", () => {
      expect(decidePetRouting({ ...base, kind: "error" })).toEqual({ toPet: true, suppressDesktopAndToast: false });
    });

    it("suppresses desktop + toast in pet-only tier", () => {
      expect(decidePetRouting({ ...base, tier: "pet-only", kind: "error" })).toEqual({
        toPet: true,
        suppressDesktopAndToast: true,
      });
    });

    it("ignores kinds outside the pet's own set (independent of desktop mutes)", () => {
      expect(decidePetRouting({ ...base, kind: "info" }).toPet).toBe(false);
    });

    it("stays silent when disabled, in os-only tier, or on daemon-notified events", () => {
      expect(decidePetRouting({ ...base, petEnabled: false, kind: "error" }).toPet).toBe(false);
      expect(decidePetRouting({ ...base, tier: "os-only", kind: "error" }).toPet).toBe(false);
      expect(decidePetRouting({ ...base, osNotified: true, kind: "error" }).toPet).toBe(false);
    });

    it("never suppresses desktop for an event the pet does not handle", () => {
      expect(decidePetRouting({ ...base, tier: "pet-only", kind: "info" })).toEqual({
        toPet: false,
        suppressDesktopAndToast: false,
      });
    });
  });

  describe("bubbleAction", () => {
    it("routes the switch suggestion to the confirm dialog", () => {
      expect(bubbleAction("Usage limit near", "claude/work hit ≥80% — suggested profile: claude/private.")).toBe(
        "switch",
      );
    });

    it("routes the app's own release events to Settings › Updates", () => {
      expect(bubbleAction("Update available — v1.8.0", "Open Settings › Updates to install it.")).toBe("updates");
      expect(bubbleAction("Updated to v1.8.0", "Restart agent-switch to apply.")).toBe("updates");
      expect(bubbleAction("Update to v1.8.0 failed", "Open Settings › Updates to retry.")).toBe("updates");
    });

    it("routes agent-config events to Ecosystem and tool updates to Tooling", () => {
      expect(bubbleAction("agent-config update available", "v1 → v2 — use the banner below to update.")).toBe(
        "ecosystem",
      );
      expect(bubbleAction("rtk update available", "v0.4 → v0.5 — open Tooling to update.")).toBe("tooling");
      expect(bubbleAction("claude update available", "v2.1 → v2.2 — open Tooling to update.")).toBe("tooling");
    });

    it("leaves ordinary notifications non-actionable", () => {
      expect(bubbleAction("Usage fetch failed", "Could not fetch usage limits for claude/work.")).toBeNull();
      expect(bubbleAction("Test notification 3 of 25", "Dev test event #3.")).toBeNull();
    });
  });

  it("grades context mood at the 60/80 boundaries", () => {
    expect(contextMood(null)).toBeNull();
    expect(contextMood(59)).toBeNull();
    expect(contextMood(60)).toBe("watch");
    expect(contextMood(79)).toBe("watch");
    expect(contextMood(80)).toBe("alarm");
    expect(contextMood(100)).toBe("alarm");
  });

  it("falls back to the default pet on unknown ids", () => {
    expect(asPetId("the-ceo")).toBe("the-ceo");
    expect(asPetId("not-a-pet")).toBe(PET_IDS[0]);
    expect(asPetId(null)).toBe(PET_IDS[0]);
  });
});
