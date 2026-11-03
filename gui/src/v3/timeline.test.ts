import { describe, expect, it } from "vitest";
import fx from "./fixtures/timeline-claude-2.1.316.json";
import { fold, openApprovals, type AsEvent } from "./timeline.js";
import { visibleRange } from "./virtual.js";

const transcript = fx.transcript as AsEvent[];
const stream = fx.stream as AsEvent[];

describe("fold", () => {
  it("a recorded transcript: two prompts, tools with results, the edit's diff, the subagent", () => {
    const f = fold(transcript);
    expect(f.rows.map((r) => r.k)).toEqual(["user", "tool", "tool", "tool", "tool", "assistant", "user", "subagent", "assistant"]);
    // A transcript has no turn end; the caller decides whether the session is live.
    expect(f.running).toBe(true);
    expect(f.rows.filter((r) => (r.k === "tool" || r.k === "subagent") && r.state === "running")).toEqual([]);
    const edit = f.rows.find((r) => r.k === "tool" && r.name === "Edit");
    expect(edit).toMatchObject({ state: "ok", diffs: [{ added: 1, removed: 1 }] });
    expect(f.rows.find((r) => r.k === "subagent")).toMatchObject({ type: "general-purpose", state: "ok" });
    expect(f.hidden["api-request-blob"]).toBeGreaterThan(0);
  });

  it("a live stream: deltas become one assistant row, finished by the complete message; the approval stays open until resolved", () => {
    const f = fold(stream);
    const texts = f.rows.filter((r) => r.k === "assistant");
    expect(texts).toHaveLength(1);
    expect(texts[0]).toMatchObject({ live: false });
    expect(openApprovals(f.rows)).toHaveLength(1);
    expect(f.limits?.status).toBe("allowed");
    expect(f.lastTurn?.ok).toBe(true);
    const id = openApprovals(f.rows)[0].id;
    expect(openApprovals(fold([...stream, { t: "approval.resolved", id, decision: "allow" }]).rows)).toHaveLength(0);
  });

  it("while streaming: one live row grows; a new turn is running until it ends", () => {
    const f = fold([
      { t: "turn", id: "u", at: null },
      { t: "message", id: "u", role: "user", text: "hi", images: 0 },
      { t: "message.delta", id: "m:0", text: "Hel" },
      { t: "message.delta", id: "m:0", text: "lo" },
      { t: "tool.started", id: "t", name: "Bash", summary: "ls", input: {}, parentToolId: null },
    ]);
    expect(f.running).toBe(true);
    expect(f.rows.map((r) => [r.k, "text" in r ? r.text : ""])).toEqual([["user", "hi"], ["assistant", "Hello"], ["tool", ""]]);
    expect(f.rows[1]).toMatchObject({ live: true });
    const ended = fold([...([] as AsEvent[]), { t: "tool.started", id: "t", name: "Bash", summary: "", input: {}, parentToolId: null }, { t: "turn.end", ok: false, durationMs: 1, costUsd: null }]);
    expect(ended.rows[0]).toMatchObject({ state: "failed" });
  });

  it("errors, plans and questions are rows; orphan results and diffs are ignored", () => {
    const f = fold([
      { t: "tool.finished", id: "nope", ok: true, summary: "" },
      { t: "diff", toolId: "nope", path: "x", added: 1, removed: 0, hunks: [] },
      { t: "subagent.finished", id: "nope", ok: true },
      { t: "approval.resolved", id: "nope", decision: "deny" },
      { t: "plan", id: "p", text: "1. a" },
      { t: "question.requested", id: "q", questions: [{ question: "Which?", options: ["A"] }] },
      { t: "error", message: "boom" },
      { t: "thinking", id: "th" },
    ]);
    expect(f.rows.map((r) => r.k)).toEqual(["plan", "question", "error"]);
  });
});

describe("visibleRange", () => {
  it("renders only what is near the viewport, using measured heights where known", () => {
    const heights = Array.from({ length: 1000 }, (_, i) => (i % 2 ? 100 : undefined));
    const r = visibleRange(1000, heights, 50, 30_000, 800, 200);
    expect(r.total).toBe(500 * 100 + 500 * 50);
    expect(r.start).toBeGreaterThan(300);
    expect(r.end - r.start).toBeLessThan(40);
    expect(r.top).toBeLessThanOrEqual(30_000 - 200);
  });
  it("edges: empty, top, past the end", () => {
    expect(visibleRange(0, [], 50, 0, 800)).toEqual({ start: 0, end: 0, top: 0, total: 0 });
    expect(visibleRange(3, [], 50, 0, 800)).toMatchObject({ start: 0, end: 3 });
    expect(visibleRange(3, [], 50, 10_000, 800)).toMatchObject({ start: 3, end: 3 });
  });
});
