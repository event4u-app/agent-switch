import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChangesWindow, ChildrenWindow, SummaryWindow, changedFiles, type SummaryFacts } from "./panels.js";

afterEach(cleanup);
const facts = (over: Partial<SummaryFacts> = {}): SummaryFacts => ({
  next: { text: "CI fails on e2e; send it to the agent.", action: "Send to agent" },
  pr: { number: 311, url: "https://github.com/o/r/pull/311", ci: "FAILURE", lifecycle: "OPEN", mergeable: "CONFLICTING", review: "REVIEW_REQUIRED", failingChecks: ["e2e (chromium)"] },
  git: { branch: "feat/checkout", worktree: true, changed: 3, ahead: 1, behind: 0 },
  limit: null,
  more: { id: "7f3c…", host: "tmux · as-501", library: "pinned · in vault", children: "1 subagent" },
  ...over,
});
const sum = (f: SummaryFacts, extra: object = {}) => <SummaryWindow f={f} onNext={vi.fn()} onCreatePr={vi.fn()} onOpenPr={vi.fn()} onHide={vi.fn()} moreOpen={false} onToggleMore={vi.fn()} {...extra} />;

describe("right tool windows (spec §9)", () => {
  it("Summary: next step with one action, the PR's axes and failing checks, git in one line, provenance in the tooltip", () => {
    const onNext = vi.fn();
    render(sum(facts(), { onNext }));
    fireEvent.click(screen.getByText("Send to agent"));
    expect(onNext).toHaveBeenCalledOnce();
    expect(screen.getByText("CI failing")).toBeTruthy();
    expect(screen.getByText("open · conflict · review required")).toBeTruthy();
    expect(screen.getByText("e2e (chromium) failed")).toBeTruthy();
    expect(screen.getByText("3 changed")).toBeTruthy();
    expect(screen.getByText("3 changed").parentElement!.textContent).toBe("3 changed · ↑1 ↓0");
    expect(screen.getByText("Pull request").getAttribute("title")).toBe("GitHub · refreshed every 60 s while the session runs");
  });

  it("Summary without a PR offers Create PR; no next step, no box", () => {
    const onCreatePr = vi.fn();
    render(sum(facts({ pr: null, next: null }), { onCreatePr }));
    expect(screen.queryByText("Send to agent")).toBeNull();
    fireEvent.click(screen.getByText("Create PR…"));
    expect(onCreatePr).toHaveBeenCalledOnce();
  });

  it("Changes: summary line, status letters, Review waits for v3.1", () => {
    const files = changedFiles("12\t3\tsrc/a.ts\n40\t0\tsrc/new.ts\n", " M src/a.ts\nA  src/new.ts\n?? notes.md\n");
    expect(files.map((f) => [f.status, f.path, f.added, f.removed])).toEqual([["M", "src/a.ts", 12, 3], ["A", "src/new.ts", 40, 0], ["?", "notes.md", 0, 0]]);
    render(<ChangesWindow files={files} onReview={vi.fn()} onCommit={vi.fn()} onHide={vi.fn()} reviewAvailable={false} />);
    expect(screen.getByText("worktree vs HEAD")).toBeTruthy();
    expect(screen.getByText(/3 files/)).toBeTruthy();
    expect((screen.getByText("Review changes").closest("button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("Children: the count in words, the lines, and the note on provenance", () => {
    const onHide = vi.fn();
    render(<ChildrenWindow noun="1 subagent" onHide={onHide} children={[{ id: "a", label: "Explore", kind: "subagent", state: "working", source: "hook" }]} />);
    expect(screen.getByText("1 subagent")).toBeTruthy();
    expect(screen.getByText("Explore")).toBeTruthy();
    expect(screen.getByText(/never guessed/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Hide ⌘I"));
    expect(onHide).toHaveBeenCalledOnce();
  });
});
