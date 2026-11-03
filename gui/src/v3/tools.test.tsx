import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ToolsPage, updateNeeds } from "./tools.js";
import type { ToolEntry } from "../vm/types.js";

afterEach(cleanup);
const tool = (over: Partial<ToolEntry>): ToolEntry => ({ id: "claude", name: "Claude Code", role: "agent", present: true, version: "2.1.0", latest: "2.1.0", healthy: true, ...over });

describe("Tools (spec §10.4)", () => {
  it("an outdated installed tool becomes one Update item; current, missing or unchecked tools do not", () => {
    const items = updateNeeds([tool({ latest: "2.2.0" }), tool({ id: "codex", name: "Codex" }), tool({ id: "rtk", present: false, version: null, latest: "1.0" }), tool({ id: "x", latest: null })], "2026-11-02T12:00:00Z");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "update", subject: "tool:claude", who: "Claude Code", what: "2.1.0 → 2.2.0", verb: "Update", version: "2.2.0" });
    expect(items[0].detail).toBe("Running sessions keep the version they started with.");
  });

  it("the 2.11 screen sits on the page body", () => {
    render(
      <ToolsPage>
        <p>tool list</p>
      </ToolsPage>,
    );
    expect(screen.getByText("Tools")).toBeTruthy();
    expect(screen.getByText("tool list")).toBeTruthy();
  });
});
