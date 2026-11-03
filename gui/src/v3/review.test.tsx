import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReviewFileJson } from "../ipc.js";
import { Review, type ReviewActions } from "./review.js";
import { ReviewHost } from "./adapter/ReviewHost.js";

afterEach(cleanup);

const FILES: ReviewFileJson[] = [
  {
    path: "src/engine/ingest.ts",
    status: "M",
    added: 2,
    removed: 1,
    hunks: [
      { oldStart: 40, newStart: 40, lines: [" a", "-b", "+c"], layer: "committed", hash: "h1", header: "@@ -40,2 +40,2 @@ export function ingest" },
      { oldStart: 60, newStart: 60, lines: ["+d"], layer: "unstaged", hash: "h2", header: "@@ -60 +60 @@" },
    ],
  },
  { path: "src/engine/store.ts", status: "M", added: 1, removed: 0, hunks: [{ oldStart: 1, newStart: 1, lines: ["+s"], layer: "staged", hash: "h3", header: "@@ -1 +1 @@" }] },
  { path: "notes.md", status: "?", added: 1, removed: 0, hunks: [{ oldStart: 0, newStart: 1, lines: ["+n"], layer: "unstaged", hash: "h4", header: "@@ -0,0 +1 @@" }] },
];

function on(over: Partial<ReviewActions> = {}): ReviewActions {
  return { setScope: vi.fn(), stage: vi.fn(), unstage: vi.fn(), discard: vi.fn(), undo: vi.fn(), commit: vi.fn(), createPr: vi.fn(), ...over };
}

describe("Review", () => {
  it("the file tree with the Marker, hunks by layer with the actions that fit them", () => {
    const o = on({ comment: vi.fn() });
    render(<Review title="v3 engine" scope="worktree" files={FILES} shared={[]} running={false} loading={false} error={null} undoable={false} on={o} />);
    expect(screen.getByText("Review · v3 engine")).toBeTruthy();
    expect(screen.getByRole("treeitem", { current: true }).textContent).toContain("ingest.ts");
    fireEvent.click(screen.getAllByText("Stage hunk")[0]);
    expect(o.stage).toHaveBeenCalledWith("src/engine/ingest.ts", "h2");
    fireEvent.click(screen.getByRole("treeitem", { name: /notes\.md/ }));
    expect(screen.getByRole("treeitem", { current: true }).textContent).toContain("notes.md");
    fireEvent.click(screen.getByText("Unstage hunk"));
    expect(o.unstage).toHaveBeenCalledWith("src/engine/store.ts", "h3");
    expect(screen.getAllByText("Stage hunk")).toHaveLength(2);
    expect(screen.getAllByText("committed").length).toBe(1);
    fireEvent.click(screen.getByText("Commit 1 staged…"));
    expect(o.commit).toHaveBeenCalled();
    fireEvent.click(screen.getByText("Create PR"));
    expect(o.createPr).toHaveBeenCalled();
    expect(screen.getByText("Rewind stays in the terminal")).toBeTruthy();
    expect(screen.queryByText("Ask Codex to review")).toBeNull();
  });

  it("while a turn runs: the strip says so and every change action is locked with the reason", () => {
    render(<Review title="t" scope="worktree" files={FILES} shared={[]} running loading={false} error={null} undoable on={on()} />);
    expect(screen.getByText("A turn is running — stage and discard unlock when it ends")).toBeTruthy();
    for (const label of ["Stage hunk", "Discard hunk", "Unstage hunk", "Stage file", "Discard", "Undo"])
      for (const b of screen.getAllByText(label)) {
        const btn = b.closest("button")!;
        expect(btn.disabled, label).toBe(true);
        expect(btn.title).toBe("Unlocks when the turn ends");
      }
  });

  it("a line comment is queued as the next prompt; without a chat it cannot be written", () => {
    const comment = vi.fn();
    const { unmount } = render(<Review title="t" scope="worktree" files={FILES.slice(2)} shared={[]} running={false} loading={false} error={null} undoable={false} on={on({ comment })} />);
    fireEvent.click(screen.getByText("Comment → next prompt"));
    const box = screen.getByLabelText("Comment on notes.md line 1");
    fireEvent.change(box, { target: { value: "say why" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(comment).toHaveBeenCalledWith("In notes.md, line 1: say why");
    expect(screen.getByText("queued as next prompt")).toBeTruthy();
    expect(screen.getByText("sent when the turn ends")).toBeTruthy();
    unmount();
    render(<Review title="t" scope="worktree" files={FILES.slice(2)} shared={[]} running={false} loading={false} error={null} undoable={false} on={on()} />);
    expect((screen.getByText("Comment → next prompt").closest("button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("split layout, scope change, shared worktree warning, empty scope, Codex review", () => {
    const o = on({ agentReview: vi.fn() });
    const { unmount } = render(<Review title="t" scope="worktree" files={FILES.slice(0, 1)} shared={["claude/w/s2"]} running={false} loading={false} error={null} undoable={false} on={o} />);
    expect(screen.getByText(/Another session works in this worktree/)).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Split" }));
    expect(screen.getAllByText("b").length + screen.getAllByText("c").length).toBeGreaterThanOrEqual(2);
    fireEvent.click(screen.getByRole("radio", { name: "Staged" }));
    expect(o.setScope).toHaveBeenCalledWith("staged");
    fireEvent.click(screen.getByText("Ask Codex to review"));
    expect(o.agentReview).toHaveBeenCalled();
    unmount();
    render(<Review title="t" scope="staged" files={[]} shared={[]} running={false} loading={false} error={null} undoable={false} on={on()} />);
    expect(screen.getByText("No changes in this scope.")).toBeTruthy();
  });
});

describe("ReviewHost", () => {
  it("reads the scope, acts, re-reads, offers undo after a discard, commits with a message, shows refusals", async () => {
    const io = {
      sessionReview: vi.fn(async () => ({ files: FILES, shared: [], base: "abc" })),
      reviewAct: vi.fn(async (_k: string, a: string) => (a === "discard" ? "discarded a change in notes.md" : "staged a change in notes.md")),
      reviewUndo: vi.fn(async () => "restored the last discard in notes.md"),
      reviewCommit: vi.fn(async () => "1a2b3c4"),
    };
    const toast = vi.fn();
    let ask: ((m: string) => void) | null = null;
    render(<ReviewHost sessionKey="claude/w/s" title="t" running={false} toast={toast} askMessage={(f) => (ask = f)} createPr={vi.fn()} io={io} />);
    await waitFor(() => expect(screen.getByText("3 files changed")).toBeTruthy());
    fireEvent.click(screen.getAllByText("Discard hunk")[0]);
    await waitFor(() => expect(screen.getByText("Undo")).toBeTruthy());
    expect(toast).toHaveBeenCalledWith({ tone: "ok", text: "Discarded a change in notes.md" });
    expect(io.sessionReview.mock.calls.length).toBeGreaterThan(1);
    fireEvent.click(screen.getByText("Undo"));
    await waitFor(() => expect(screen.queryByText("Undo")).toBeNull());
    fireEvent.click(screen.getByText("Commit 1 staged…"));
    await act(async () => ask!("feat: x"));
    expect(io.reviewCommit).toHaveBeenCalledWith("claude/w/s", "feat: x");
    expect(toast).toHaveBeenCalledWith({ tone: "ok", text: "Committed 1a2b3c4" });
    io.reviewAct.mockRejectedValueOnce(new Error("a turn is running — this unlocks when it ends"));
    fireEvent.click(screen.getAllByText("Stage hunk")[0]);
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ tone: "alert", text: "a turn is running — this unlocks when it ends" }));
    fireEvent.click(screen.getByRole("radio", { name: "This turn" }));
    await waitFor(() => expect(io.sessionReview).toHaveBeenLastCalledWith("claude/w/s", "turn"));
  });
});
