import { describe, expect, it } from "vitest";
import { multiLabel } from "./multi-select.js";

describe("multi-select trigger words", () => {
  const opts = [{ value: "claude", label: "Claude" }, { value: "codex", label: "Codex" }, { value: "gemini", label: "Gemini" }] as const;
  it("nothing or everything ticked reads as All; otherwise the names", () => {
    expect(multiLabel(opts, new Set(), "All tools")).toBe("All tools");
    expect(multiLabel(opts, new Set(["claude", "codex", "gemini"]), "All tools")).toBe("All tools");
    expect(multiLabel(opts, new Set(["codex"]), "All tools")).toBe("Codex");
    expect(multiLabel(opts, new Set(["claude", "gemini"]), "All tools")).toBe("Claude, Gemini");
  });
});
