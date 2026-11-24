import { describe, expect, it, vi } from "vitest";
import { LAYOUT_KEY, LAYOUT_VERSION, localLayout, parseLayout, startTabs } from "./layout.js";
import type { RowSession } from "./sessions.js";

const s = (key: string, state: RowSession["state"], extra: Partial<RowSession> = {}): RowSession => ({ key, title: key, state, account: { name: "w", nearLimit: false }, branch: null, pr: null, children: [], needsYou: false, ...extra });

describe("an older layout gets the new list defaults once (8.6)", () => {
  it("a layout saved before the version drops the old defaults it stored (activity order, one-line rows)", () => {
    const old = parseLayout(JSON.stringify({ tabs: ["a"], active: "a", comfortable: false, pinnedOnly: false, sort: "activity" }));
    expect(old).toEqual({ tabs: ["a"], active: "a", pinnedOnly: false });
  });

  it("an older layout keeps a choice the old defaults never made", () => {
    expect(parseLayout(JSON.stringify({ sort: "name", comfortable: true }))).toEqual({ sort: "name", comfortable: true });
  });

  it("a layout saved at this version keeps an explicit choice, the old defaults included", () => {
    expect(parseLayout(JSON.stringify({ version: LAYOUT_VERSION, sort: "activity", comfortable: false }))).toEqual({ version: LAYOUT_VERSION, sort: "activity", comfortable: false });
  });

  it("the store stamps the version, so the migration runs once", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
    localLayout.save({ tabs: [], active: null, comfortable: false, pinnedOnly: false, sort: "activity" });
    expect(JSON.parse(store.get(LAYOUT_KEY)!).version).toBe(LAYOUT_VERSION);
    expect(localLayout.load()).toMatchObject({ sort: "activity", comfortable: false });
    vi.unstubAllGlobals();
  });
});

describe("window layout", () => {
  it("parses field by field and drops anything malformed", () => {
    expect(parseLayout(null)).toBeNull();
    expect(parseLayout("{")).toBeNull();
    expect(parseLayout("3")).toBeNull();
    expect(parseLayout(JSON.stringify({ tabs: ["a", 2, "b"], active: "b", comfortable: true, groupByProject: "yes", pinnedOnly: false }))).toEqual({ tabs: ["a", "b"], active: "b", comfortable: true, pinnedOnly: false });
  });

  it("keeps All sessions' List or Projects (owner, 2026-11-24); anything else is dropped", () => {
    expect(parseLayout(JSON.stringify({ version: 2, tableGroup: "project" }))?.tableGroup).toBe("project");
    expect(parseLayout(JSON.stringify({ version: 2, tableGroup: "none" }))?.tableGroup).toBe("none");
    expect(parseLayout(JSON.stringify({ version: 2, tableGroup: "tool" }))?.tableGroup).toBeUndefined();
  });

  it("restores the saved tabs that still exist, and their active one", () => {
    expect(startTabs({ tabs: ["gone", "b", "a"], active: "a" }, [s("a", "idle"), s("b", "idle")])).toEqual({ tabs: ["b", "a"], active: "a" });
    expect(startTabs({ tabs: ["b"], active: "gone" }, [s("a", "idle"), s("b", "idle")])).toEqual({ tabs: ["b"], active: "b" });
  });

  it("else opens the first live session: needs you before CI failing before working", () => {
    const list = [s("idle", "idle"), s("work", "working"), s("ci", "idle", { pr: { number: 1, ci: "FAILURE", mergeable: "MERGEABLE" } }), s("ask", "needs-you"), s("done", "done")];
    expect(startTabs(null, list)).toEqual({ tabs: ["ask"], active: "ask" });
    expect(startTabs({ tabs: ["gone"] }, list.slice(0, 3))).toEqual({ tabs: ["ci"], active: "ci" });
  });

  it("with no live session it opens nothing", () => {
    expect(startTabs(null, [])).toEqual({ tabs: [], active: null });
    expect(startTabs(null, [s("done", "done")])).toEqual({ tabs: [], active: null });
  });
});
