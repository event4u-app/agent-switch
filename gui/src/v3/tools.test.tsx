import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

  // tools.png: one card, one row per tool — name over path, version, then
  // "up to date" or "Update to x"; Check now in the header; the agent-config
  // card (spec §11) under the table, never above it.
  it("one row per tool as on the board, the 2.11 agent-config card below", () => {
    const on = { check: vi.fn(), update: vi.fn(), install: vi.fn() };
    render(
      <ToolsPage
        rows={[
          { id: "claude", name: "Claude Code", where: "/usr/local/bin/claude", version: "2.4.1", status: "ok", latest: "2.4.1" },
          { id: "codex", name: "Codex CLI", where: "/opt/homebrew/bin/codex", version: "0.148.0", status: "update", latest: "0.150.0" },
          { id: "rtk", name: "rtk", where: null, version: null, status: "missing", latest: null },
          { id: "agy", name: "Antigravity CLI", where: "/x/agy", version: "1.4.12", status: "unknown", latest: null },
        ]}
        checking={false}
        on={on}
        below={<p>agent-config card</p>}
      />,
    );
    expect(screen.getByText("What Agent Switch runs, which version, and what's new. Updates never touch running sessions.")).toBeTruthy();
    expect(screen.getByText("/usr/local/bin/claude")).toBeTruthy();
    expect(screen.getByText("up to date")).toBeTruthy();
    expect(screen.getByText("latest unknown")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Update to 0.150.0/ }));
    expect(on.update).toHaveBeenCalledWith("codex");
    fireEvent.click(screen.getByRole("button", { name: /Install/ }));
    expect(on.install).toHaveBeenCalledWith("rtk");
    fireEvent.click(screen.getByRole("button", { name: /Check now/ }));
    expect(on.check).toHaveBeenCalled();
    const table = screen.getByRole("list", { name: "Tools" });
    const card = screen.getByText("agent-config card");
    expect(table.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("Check now says it is checking and cannot be pressed twice", () => {
    render(<ToolsPage rows={[]} checking on={{ check: vi.fn(), update: vi.fn(), install: vi.fn() }} />);
    expect((screen.getByRole("button", { name: /Checking/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
