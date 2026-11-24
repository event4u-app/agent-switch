import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HistorySheet } from "./history.js";

afterEach(cleanup);
const NOW = Date.UTC(2026, 10, 24, 12);
const ev = [
  { id: "1", at: NOW - 60_000 * 5, kind: "start" as const, text: "Fix wedge: started on side" },
  { id: "2", at: NOW - 60_000 * 30, kind: "login" as const, text: "Codex · personal: sign-in failed", detail: "stored login expired", ok: false },
  { id: "3", at: NOW - 60_000 * 90, kind: "update" as const, text: "Agent Switch updated" },
];

describe("History sheet (owner, 2026-11-24, as v2)", () => {
  it("lists the log newest first, says a failure, and filters by v2's four kinds", () => {
    render(<HistorySheet events={ev} nowMs={NOW} />);
    const rows = () => [...document.querySelectorAll("[data-history-row]")].map((r) => r.textContent);
    expect(rows()).toEqual(["Fix wedge: started on side5m ago", "Codex · personal: sign-in failedfailedstored login expired30m ago", "Agent Switch updated1h 30m ago"]);
    fireEvent.click(screen.getByRole("radio", { name: "Accounts" }));
    expect(rows()).toEqual(["Codex · personal: sign-in failedfailedstored login expired30m ago"]);
    fireEvent.click(screen.getByRole("radio", { name: "Sessions" }));
    expect(rows()).toHaveLength(1);
  });
  it("an empty log says so", () => {
    render(<HistorySheet events={[]} nowMs={NOW} />);
    expect(screen.getByText("Nothing recorded yet.")).toBeTruthy();
  });
});
