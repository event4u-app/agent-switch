import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RunsPage, type RunRow } from "./runs.js";

afterEach(cleanup);

const row = (id: string, running: boolean): RunRow => ({ id, kind: "arena", label: `Arena · ${id}`, sessionKey: "s", sessionTitle: "Session", running });

describe("runs page (owner, 2026-11-25: active only by default)", () => {
  it("opens on the running ones, also when none runs", () => {
    render(<RunsPage kind="arena" rows={[row("old", false)]} onOpen={vi.fn()} />);
    expect(screen.queryByText("old")).toBeNull();
    expect(screen.getByText("No arena runs right now.")).toBeTruthy();
  });

  it("shows a running one and keeps the finished ones one click away", () => {
    render(<RunsPage kind="arena" rows={[row("live", true), row("old", false)]} onOpen={vi.fn()} />);
    expect(screen.getByText("live")).toBeTruthy();
    expect(screen.queryByText("old")).toBeNull();
    fireEvent.click(screen.getByText("Finished 1"));
    expect(screen.getByText("old")).toBeTruthy();
  });
});
