import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReviewFileJson, ReviewJson } from "../ipc.js";
import { Review, REVIEW_COLLAPSE_OVER, type ReviewActions } from "./review.js";
import { REVIEW_POLL_MS, ReviewHost } from "./adapter/ReviewHost.js";

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

  it("no Create PR for a session whose PR is already open", () => {
    render(<Review title="t" scope="worktree" files={FILES} shared={[]} running={false} loading={false} error={null} undoable={false} on={on({ createPr: undefined })} />);
    expect(screen.queryByText("Create PR")).toBeNull();
  });

  it("opened at a file: that file is selected and expanded; a new target moves the selection", () => {
    const props = { title: "t", scope: "worktree" as const, files: FILES, shared: [], running: false, loading: false, error: null, undoable: false, on: on() };
    const { rerender } = render(<Review {...props} focus={{ file: "notes.md", seq: 1 }} />);
    expect(screen.getByRole("treeitem", { current: true }).textContent).toContain("notes.md");
    fireEvent.click(screen.getByLabelText("Collapse src/engine/store.ts"));
    rerender(<Review {...props} focus={{ file: "src/engine/store.ts", seq: 2 }} />);
    expect(screen.getByRole("treeitem", { current: true }).textContent).toContain("store.ts");
    expect(screen.getByLabelText("Collapse src/engine/store.ts")).toBeTruthy();
  });

  it("a file target that is not loaded yet is selected once the files arrive", () => {
    const props = { title: "t", scope: "worktree" as const, shared: [], running: false, error: null, undoable: false, on: on(), focus: { file: "notes.md", seq: 1 } };
    const { rerender } = render(<Review {...props} files={[]} loading />);
    rerender(<Review {...props} files={FILES} loading={false} />);
    expect(screen.getByRole("treeitem", { current: true }).textContent).toContain("notes.md");
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

describe("Review: what it compares with, and large reviews", () => {
  const base = { title: "t", shared: [], running: false, loading: false, error: null, undoable: false, on: on() };

  it("offers Uncommitted first and names the base it compared with", () => {
    render(<Review {...base} scope="worktree" files={FILES} compare={{ ref: "origin/dev/v3", sha: "abc1234def567", note: null, omitted: 0 }} />);
    expect(screen.getAllByRole("radio").map((r) => r.textContent)).toEqual(["Uncommitted", "This turn", "Session", "Branch vs main", "Staged", "Unified", "Split"]);
    expect(screen.getByText("Compared with origin/dev/v3 (abc1234)")).toBeTruthy();
  });

  it("a scope that cannot compare says why instead of showing no changes", () => {
    render(<Review {...base} scope="session" files={[]} compare={{ ref: null, sha: null, note: "The commit this session started on was not found.", omitted: 0 }} />);
    expect(screen.getByRole("status").textContent).toContain("The commit this session started on was not found.");
    expect(screen.queryByText("No changes in this scope.")).toBeNull();
  });

  it("past the collapse threshold every card starts closed but the one opened at; omitted files say so", () => {
    const many: ReviewFileJson[] = Array.from({ length: REVIEW_COLLAPSE_OVER + 1 }, (_, i) => ({ path: `f${String(i).padStart(2, "0")}.ts`, status: "M", added: 1, removed: 0, hunks: [{ oldStart: 1, newStart: 1, lines: [`+x${i}`], layer: "unstaged", hash: `h${i}`, header: "@@" }] }));
    many.push({ path: "zz-huge.ts", status: "M", added: 90000, removed: 0, hunks: [], omitted: true });
    render(<Review {...base} scope="worktree" files={many} focus={{ file: "f03.ts", seq: 1 }} compare={{ ref: "main", sha: null, note: null, omitted: 1 }} />);
    expect(screen.getByLabelText("Collapse f03.ts")).toBeTruthy();
    expect(screen.getByLabelText("Expand f00.ts")).toBeTruthy();
    expect(screen.queryByText("+x0")).toBeNull();
    fireEvent.click(screen.getByLabelText("Expand zz-huge.ts"));
    expect(screen.getByText(/Too large to show here/)).toBeTruthy();
    expect(screen.getByText(/1 file too large to show/)).toBeTruthy();
  });

  it("files past the file cap are counted, the same words as the Changes list", () => {
    render(<Review {...base} scope="uncommitted" files={FILES} compare={{ ref: "HEAD", sha: null, note: null, omitted: 0, more: 7 }} />);
    expect(screen.getByText("7 more files not listed")).toBeTruthy();
  });

  it("opened at a file, the card scrolls only as far as it must, so Scope and Layout stay in view", () => {
    const spy = vi.fn();
    const orig = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = spy;
    try {
      render(<Review {...base} scope="uncommitted" files={FILES} focus={{ file: "notes.md", seq: 1 }} />);
      expect(spy).toHaveBeenCalledWith({ block: "nearest" });
    } finally {
      HTMLElement.prototype.scrollIntoView = orig;
    }
  });

  it("a small review stays open", () => {
    render(<Review {...base} scope="worktree" files={FILES} />);
    expect(screen.getAllByLabelText(/^Collapse /)).toHaveLength(FILES.length);
  });
});

describe("ReviewHost", () => {
  const io = () => ({
    sessionReview: vi.fn(async (_k: string, _s: string, _since?: string): Promise<ReviewJson> => ({ files: FILES, shared: [], base: null, baseRef: "HEAD", note: null, omitted: 0, fingerprint: "fp1" })),
    reviewAct: vi.fn(async () => ""),
    reviewUndo: vi.fn(async () => ""),
    reviewCommit: vi.fn(async () => ""),
  });

  it("opens on Uncommitted — the files the count it was opened from counts — and goes back to it on every open", async () => {
    const x = io();
    const props = { sessionKey: "claude/w/s", title: "t", running: false, toast: vi.fn(), askMessage: vi.fn(), createPr: vi.fn(), io: x };
    const { rerender } = render(<ReviewHost {...props} focus={{ seq: 1 }} />);
    await waitFor(() => expect(x.sessionReview).toHaveBeenCalledWith("claude/w/s", "uncommitted"));
    fireEvent.click(screen.getByRole("radio", { name: "Branch vs main" }));
    await waitFor(() => expect(x.sessionReview).toHaveBeenLastCalledWith("claude/w/s", "worktree"));
    rerender(<ReviewHost {...props} focus={{ file: "notes.md", seq: 2 }} />);
    await waitFor(() => expect(x.sessionReview).toHaveBeenLastCalledWith("claude/w/s", "uncommitted"));
  });

  it("while a turn runs it polls with the last fingerprint and keeps what it shows when nothing changed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const x = io();
      render(<ReviewHost sessionKey="claude/w/s" title="t" running toast={vi.fn()} askMessage={vi.fn()} createPr={vi.fn()} io={x} />);
      await waitFor(() => expect(x.sessionReview).toHaveBeenCalledTimes(1));
      x.sessionReview.mockResolvedValue({ unchanged: true, fingerprint: "fp1" });
      await act(async () => void vi.advanceTimersByTime(REVIEW_POLL_MS));
      await waitFor(() => expect(x.sessionReview).toHaveBeenCalledTimes(2));
      expect(x.sessionReview).toHaveBeenLastCalledWith("claude/w/s", "uncommitted", "fp1");
      expect(screen.getAllByRole("treeitem")).toHaveLength(FILES.length);
      expect(screen.queryByText("Reading the changes…")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a tab switch mid-load never shows or acts on the other session's files: actions wait for the new session's own read", async () => {
    const x = io();
    const pending: { key: string; resolve: (r: ReviewJson) => void }[] = [];
    x.sessionReview.mockImplementation((k: string) => new Promise<ReviewJson>((resolve) => pending.push({ key: k, resolve })));
    const props = { title: "t", running: false, toast: vi.fn(), askMessage: vi.fn(), createPr: vi.fn(), io: x };
    const { rerender } = render(<ReviewHost {...props} sessionKey="claude/w/a" />);
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => pending[0].resolve({ files: FILES, shared: [], base: null, baseRef: "HEAD", note: null, omitted: 0, more: 0, fingerprint: "a" }));
    await waitFor(() => expect(screen.getAllByText("Discard").length).toBeGreaterThan(0));
    // The same host now shows session b, whose read has not come back yet.
    rerender(<ReviewHost {...props} sessionKey="claude/w/b" />);
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(screen.queryByText("src/engine/ingest.ts")).toBeNull();
    for (const b of screen.queryAllByRole("button", { name: /Discard|Stage|Commit|Create PR/ })) expect((b as HTMLButtonElement).disabled).toBe(true);
    // a's late answer is not b's data.
    await act(async () => pending[0].resolve({ files: FILES, shared: [], base: null, baseRef: "HEAD", note: null, omitted: 0, more: 0, fingerprint: "a" }));
    expect(screen.queryByText("src/engine/ingest.ts")).toBeNull();
    const own: ReviewFileJson[] = [{ path: "b.ts", status: "M", added: 1, removed: 0, hunks: [{ oldStart: 1, newStart: 1, lines: ["+b"], layer: "unstaged", hash: "hb", header: "@@ -1 +1 @@" }] }];
    await act(async () => pending[1].resolve({ files: own, shared: [], base: null, baseRef: "HEAD", note: null, omitted: 0, more: 0, fingerprint: "b" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Discard" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(x.reviewAct).toHaveBeenCalledWith("claude/w/b", "discard", "b.ts", undefined);
  });

  it("a scope switch mid-load disables every action until that scope's files are read", async () => {
    const x = io();
    render(<ReviewHost sessionKey="claude/w/s" title="t" running={false} toast={vi.fn()} askMessage={vi.fn()} createPr={vi.fn()} io={x} />);
    await waitFor(() => expect(screen.getAllByText("Discard").length).toBeGreaterThan(0));
    let resolve: (r: ReviewJson) => void = () => {};
    x.sessionReview.mockImplementationOnce(() => new Promise<ReviewJson>((r) => (resolve = r)));
    fireEvent.click(screen.getByRole("radio", { name: "Staged" }));
    await waitFor(() => expect(x.sessionReview).toHaveBeenLastCalledWith("claude/w/s", "staged"));
    for (const b of screen.queryAllByRole("button", { name: /Discard|Stage|Unstage|Commit|Create PR/ })) expect((b as HTMLButtonElement).disabled).toBe(true);
    await act(async () => resolve({ files: [FILES[1]], shared: [], base: null, baseRef: "HEAD", note: null, omitted: 0, more: 0, fingerprint: "s" }));
    await waitFor(() => expect((screen.getByText("Unstage hunk").closest("button") as HTMLButtonElement).disabled).toBe(false));
  });

  it("a review the CLI refuses (git failed or timed out) is shown as an error, not as no changes", async () => {
    const x = io();
    x.sessionReview.mockRejectedValueOnce(new Error("git diff failed: timed out after 5 s"));
    render(<ReviewHost sessionKey="claude/w/s" title="t" running={false} toast={vi.fn()} askMessage={vi.fn()} createPr={vi.fn()} io={x} />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("timed out after 5 s"));
    expect(screen.queryByText("No changes in this scope.")).toBeNull();
  });

  it("reads the scope, acts, re-reads, offers undo after a discard, commits with a message, shows refusals", async () => {
    const io = {
      sessionReview: vi.fn(async (): Promise<ReviewJson> => ({ files: FILES, shared: [], base: "abc", baseRef: "main", note: null, omitted: 0, fingerprint: "f" })),
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
