import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildRebindDialog,
  resolveRebindChoice,
  selectableRows,
  type RebindDialogCandidate,
} from "../src/rebind-dialog.js";
import type { UsageSnapshot } from "../src/usage.js";

const AT = "2026-07-25T12:00:00.000Z";

/** A snapshot whose single window carries `util`% utilization (null → unknown). */
const snap = (util: number | null): UsageSnapshot => ({
  windows: [{ key: "seven_day", label: "7d", utilization: util, resetsAt: null }],
  routines: null,
  capturedAt: AT,
});

const cand = (name: string, util: number | null, label: string | null = null): RebindDialogCandidate => ({
  name,
  snapshot: snap(util),
  label,
});

test("buildRebindDialog suggests the lowest-max-utilization non-running profile", () => {
  const d = buildRebindDialog(
    [cand("work", 40), cand("acme", 20), cand("privat", 70)],
    "running",
  );
  // acme has the most headroom (lowest utilization) → it is pre-selected.
  assert.equal(d.suggestedProfile, "acme");
});

test("buildRebindDialog excludes the running profile from rows-as-targets and from the suggestion", () => {
  const d = buildRebindDialog(
    [cand("run", 5), cand("work", 40), cand("acme", 20)],
    "run",
  );
  // The running profile is flagged and never suggested, even though its 5% is the lowest.
  const runRow = d.rows.find((r) => r.profile === "run");
  assert.ok(runRow, "running profile still appears in rows");
  assert.equal(runRow!.isRunning, true, "running profile flagged isRunning");
  assert.notEqual(d.suggestedProfile, "run", "running profile never suggested despite lowest util");
  assert.equal(d.suggestedProfile, "acme");
  // It is not a selectable target.
  assert.equal(selectableRows(d).some((r) => r.profile === "run"), false);
});

test("buildRebindDialog returns suggestedProfile: null when no other profile exists", () => {
  const d = buildRebindDialog([cand("run", 5)], "run");
  assert.equal(d.suggestedProfile, null);
  assert.equal(selectableRows(d).length, 0);
});

test("buildRebindDialog rows carry the usage (maxUtil) and label; null usage when no snapshot", () => {
  const d = buildRebindDialog(
    [
      { name: "work", snapshot: snap(63), label: "Work" },
      { name: "acme", snapshot: null, label: "Personal" },
    ],
    "running",
  );
  const work = d.rows.find((r) => r.profile === "work")!;
  const acme = d.rows.find((r) => r.profile === "acme")!;
  assert.equal(work.maxUtil, 63);
  assert.equal(work.label, "Work");
  assert.equal(acme.maxUtil, null, "no snapshot → maxUtil null (row still shown)");
  assert.equal(acme.label, "Personal");
  // A profile with no usage is skipped for the suggestion; the known one wins.
  assert.equal(d.suggestedProfile, "work");
});

test("buildRebindDialog: null suggestion when no candidate has a known usage value", () => {
  const d = buildRebindDialog(
    [
      { name: "work", snapshot: null, label: null },
      { name: "acme", snapshot: null, label: null },
    ],
    "running",
  );
  assert.equal(d.suggestedProfile, null);
  assert.equal(selectableRows(d).length, 2, "rows still shown even without usage");
});

// ---------- resolveRebindChoice (pure selection -> target mapping) ----------

test("resolveRebindChoice maps a 1-based index to the selectable profile", () => {
  const d = buildRebindDialog([cand("work", 40), cand("acme", 20)], "running");
  assert.deepEqual(resolveRebindChoice("1", d), { kind: "target", profile: "work" });
  assert.deepEqual(resolveRebindChoice("2", d), { kind: "target", profile: "acme" });
});

test("resolveRebindChoice: empty input accepts the pre-selected suggestion", () => {
  const d = buildRebindDialog([cand("work", 40), cand("acme", 20)], "running");
  assert.deepEqual(resolveRebindChoice("", d), { kind: "target", profile: "acme" });
  assert.deepEqual(resolveRebindChoice("   ", d), { kind: "target", profile: "acme" });
});

test("resolveRebindChoice: empty input is invalid when there is no suggestion", () => {
  const d = buildRebindDialog(
    [{ name: "work", snapshot: null, label: null }],
    "running",
  );
  assert.deepEqual(resolveRebindChoice("", d), { kind: "invalid" });
});

test("resolveRebindChoice: q or c cancels (case-insensitive)", () => {
  const d = buildRebindDialog([cand("work", 40)], "running");
  assert.deepEqual(resolveRebindChoice("q", d), { kind: "cancel" });
  assert.deepEqual(resolveRebindChoice("C", d), { kind: "cancel" });
});

test("resolveRebindChoice: out-of-range or garbage input is invalid (never switches)", () => {
  const d = buildRebindDialog([cand("work", 40), cand("acme", 20)], "running");
  assert.deepEqual(resolveRebindChoice("0", d), { kind: "invalid" });
  assert.deepEqual(resolveRebindChoice("3", d), { kind: "invalid" });
  assert.deepEqual(resolveRebindChoice("xyz", d), { kind: "invalid" });
  assert.deepEqual(resolveRebindChoice("1.5", d), { kind: "invalid" });
});

test("resolveRebindChoice indexes only selectable rows, skipping the running profile", () => {
  // running appears first in candidates; it must not be index 1.
  const d = buildRebindDialog([cand("run", 5), cand("work", 40), cand("acme", 20)], "run");
  assert.deepEqual(resolveRebindChoice("1", d), { kind: "target", profile: "work" });
  assert.deepEqual(resolveRebindChoice("2", d), { kind: "target", profile: "acme" });
  // only two selectable → 3 is out of range.
  assert.deepEqual(resolveRebindChoice("3", d), { kind: "invalid" });
});
