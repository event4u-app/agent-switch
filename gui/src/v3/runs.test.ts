import { describe, expect, it } from "vitest";
import { runName, runRows, runningCounts } from "./runs.js";
import type { ChildModel } from "./sessions.js";

const c = (id: string, label: string, kind: ChildModel["kind"], state: ChildModel["state"], children?: ChildModel[]): ChildModel => ({ id, label, kind, state, source: "files", ...(children ? { children } : {}) });

describe("runs", () => {
  const sessions = [
    { key: "a", title: "Arena session", children: [c("board:a|arena:x", "Arena · x · round 2", "arena-board", "working", [c("board:a|workflow:w1", "x-arena-judge · 1/2", "workflow", "working")]), c("board:a|council", "Council", "council-board", "done")] },
    { key: "b", title: "Panel session", children: [c("board:b|workflow:p", "panel-decide · 2/4", "workflow", "working"), c("board:b|workflow:q", "build · 1/1", "workflow", "done"), c("s1", "Explore", "subagent", "working")] },
  ];
  it("finds arenas, councils and panels at the top level only", () => {
    const rows = runRows(sessions);
    expect(rows.map((r) => [r.kind, r.id])).toEqual([
      ["arena", "board:a|arena:x"],
      ["council", "board:a|council"],
      ["panel", "board:b|workflow:p"],
    ]);
    expect(runningCounts(rows)).toEqual({ arena: 1, council: 0, panel: 1 });
  });
  it("drops the kind prefix from the name", () => {
    expect(runName(runRows(sessions)[0])).toBe("x · round 2");
  });
});
