import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { SessionRow, type RowSession } from "./sessions.js";

// Spec §14: checks that hold for every screen, run over the source tree. Read
// through Vite rather than node:fs — CI installs inside gui/ only, without @types/node.
// Vite keys this folder's own files "./x", the rest "../dir/x"; both become "dir/x".
const SOURCES = Object.entries(import.meta.glob<string>(["../**/*.{ts,tsx}", "!../**/*.test.{ts,tsx}"], { query: "?raw", import: "default", eager: true })).map(([p, text]) => ({ path: p.startsWith("./") ? `v3/${p.slice(2)}` : p.slice(3), text }));

describe("v3 design guard (spec §14)", () => {
  it("no selection drawn as an inset shadow bar", () => {
    const hits = SOURCES.filter((f) => /shadow-\[inset_(2px|0_2px)/.test(f.text)).map((f) => f.path);
    expect(SOURCES.length).toBeGreaterThan(50);
    expect(hits).toEqual([]);
  });

  it("v3 code uses only the radii of spec §3.1", () => {
    // rounded-bl-md: the tree elbow (spec §5.2), the row radius on the connector's one corner.
    const allowed = new Set(["rounded", "rounded-md", "rounded-xl", "rounded-full", "rounded-none", "rounded-[10px]", "rounded-t-md", "rounded-bl-md"]);
    const bad: string[] = [];
    for (const f of SOURCES.filter((s) => s.path.startsWith("v3/"))) {
      for (const m of f.text.matchAll(/\brounded(?:-[a-z0-9[\]-]+)?/g)) {
        if (!allowed.has(m[0])) bad.push(`${f.path}: ${m[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("the active open row and its children are one block: one raise surface, one Marker (§3.2, §5.2, D12)", () => {
    const seat = (id: string) => ({ id: `claude/work/${id}`, label: `seat ${id}`, kind: "council", state: "idle" as const, source: "lineage" as const, tool: "claude" as const, account: { name: "work", color: "teal" as const } });
    const s: RowSession = { key: "p", title: "council", state: "working", account: { name: "work", nearLimit: false }, branch: "main", pr: null, children: [seat("a"), seat("b"), seat("c")], needsYou: false };
    const { container } = render(createElement(SessionRow, { s, active: true, open: true, onSelect: () => {}, onToggleChildren: () => {}, onCheck: () => {} }));
    const markers = container.querySelectorAll(".border-l-ac-brand");
    expect(markers).toHaveLength(1);
    const block = markers[0].parentElement!;
    // The fill sits on the element that holds the row and every child row, and nowhere inside it.
    expect(block.className.split(/\s+/)).toContain("bg-ac-raise");
    expect(block.querySelector("[role=button]")).toBeTruthy();
    expect(block.querySelectorAll("[data-child-row]").length).toBeGreaterThan(0);
    expect([...block.querySelectorAll("*")].filter((el) => (el.getAttribute("class") ?? "").split(/\s+/).includes("bg-ac-raise"))).toEqual([]);
    cleanup();
  });
});
