import { describe, it, expect } from "vitest";
import { buildRebindDialog, selectableRows } from "./rebind-dialog.js";

describe("buildRebindDialog (GUI mirror of the CLI rebind picker)", () => {
  it("pre-selects the best-headroom (lowest maxUtil) non-running profile", () => {
    const m = buildRebindDialog(
      [
        { name: "work", max: 80 },
        { name: "privat", max: 20 },
        { name: "third", max: 55 },
      ],
      "work",
    );
    expect(m.suggestedProfile).toBe("privat");
    // the running row is marked and dropped from the selectable list.
    expect(m.rows.find((r) => r.profile === "work")?.isRunning).toBe(true);
    expect(selectableRows(m).map((r) => r.profile)).toEqual(["privat", "third"]);
  });

  it("excludes the running profile from the suggestion even when it has the most headroom", () => {
    const m = buildRebindDialog(
      [
        { name: "work", max: 5 }, // running, lowest util — still never suggested
        { name: "privat", max: 40 },
      ],
      "work",
    );
    expect(m.suggestedProfile).toBe("privat");
  });

  it("skips unknown-usage rows for the suggestion and keeps the first on a tie", () => {
    const m = buildRebindDialog(
      [
        { name: "work", max: 90 }, // running
        { name: "a", max: null }, // unknown → never suggested
        { name: "b", max: 30 },
        { name: "c", max: 30 }, // tie → first (b) wins
      ],
      "work",
    );
    expect(m.suggestedProfile).toBe("b");
    // an unknown-usage row is still a selectable target.
    expect(selectableRows(m).map((r) => r.profile)).toEqual(["a", "b", "c"]);
  });

  it("suggests nothing when no non-running profile has a known usage value", () => {
    const m = buildRebindDialog(
      [
        { name: "work", max: 50 },
        { name: "a", max: null },
      ],
      "work",
    );
    expect(m.suggestedProfile).toBeNull();
    expect(selectableRows(m).map((r) => r.profile)).toEqual(["a"]);
  });

  it("carries the label through and defaults a missing label to null", () => {
    const m = buildRebindDialog([{ name: "a", max: 10, label: "Work" }, { name: "b", max: 20 }], "x");
    expect(m.rows[0].label).toBe("Work");
    expect(m.rows[1].label).toBeNull();
  });

  it("empty candidate set → no rows, no suggestion, no selectable targets", () => {
    const m = buildRebindDialog([], "work");
    expect(m.rows).toEqual([]);
    expect(m.suggestedProfile).toBeNull();
    expect(selectableRows(m)).toEqual([]);
  });
});
