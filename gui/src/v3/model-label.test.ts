import { describe, expect, it } from "vitest";
import { modelLabel } from "./model-label.js";

describe("modelLabel", () => {
  it.each([
    ["claude-opus-4-7", "Opus 4.7"],
    ["claude-sonnet-4-6[1m]", "Sonnet 4.6"],
    ["claude-haiku-4-5-20251001", "Haiku 4.5"],
    ["claude-opus-5-5", "Opus 5.5"],
    ["claude-fable-5-1", "Fable 5.1"],
    ["claude-opus-4", "Opus 4"],
    ["opus", "Opus"],
    ["Sonnet", "Sonnet"],
  ])("%s → %s", (id, label) => expect(modelLabel(id)).toBe(label));

  it("passes unknown ids through and keeps empty as null", () => {
    expect(modelLabel("gpt-5.5-codex")).toBe("gpt-5.5-codex");
    expect(modelLabel("claude-opusx")).toBe("claude-opusx");
    expect(modelLabel(null)).toBeNull();
    expect(modelLabel("")).toBeNull();
  });
});
