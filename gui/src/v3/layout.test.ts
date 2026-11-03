import { describe, expect, it } from "vitest";
import { parseLayout, startTabs } from "./layout.js";
import type { RowSession } from "./sessions.js";

const s = (key: string, state: RowSession["state"], extra: Partial<RowSession> = {}): RowSession => ({ key, title: key, state, account: { name: "w", nearLimit: false }, branch: null, pr: null, children: [], needsYou: false, ...extra });

describe("window layout", () => {
  it("parses field by field and drops anything malformed", () => {
    expect(parseLayout(null)).toBeNull();
    expect(parseLayout("{")).toBeNull();
    expect(parseLayout("3")).toBeNull();
    expect(parseLayout(JSON.stringify({ tabs: ["a", 2, "b"], active: "b", comfortable: true, groupByProject: "yes", pinnedOnly: false }))).toEqual({ tabs: ["a", "b"], active: "b", comfortable: true, pinnedOnly: false });
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
