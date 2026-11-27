/** The Changes window after PhpStorm's Commit tool window (owner, 2026-11-27). */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ChangesWindow, changeTree, type ChangesOp } from "./changes.js";
import type { ChangedFile } from "./panels.js";

afterEach(cleanup);

const F = (path: string, status: ChangedFile["status"] = "M"): ChangedFile => ({ status, path, added: 1, removed: 0 });
const files = [F("src/v3/a.ts"), F("src/v3/b.ts", "A"), F("src/lib/c.ts"), F("README.md")];

function mount(over: Partial<Parameters<typeof ChangesWindow>[0]> = {}) {
  const onRun = vi.fn<(op: ChangesOp) => void>();
  render(<ChangesWindow files={files} onReview={vi.fn()} onCommit={vi.fn()} onHide={vi.fn()} reviewAvailable onRun={onRun} {...over} />);
  return onRun;
}

describe("changeTree", () => {
  it("groups by folder and folds single-child chains", () => {
    const t = changeTree([F("a/b/c/x.ts"), F("a/b/c/y.ts"), F("top.ts")]);
    expect(t.dirs.map((d) => d.label)).toEqual(["a/b/c"]);
    expect(t.dirs[0].files.map((f) => f.path)).toEqual(["a/b/c/x.ts", "a/b/c/y.ts"]);
    expect(t.files.map((f) => f.path)).toEqual(["top.ts"]);
  });
});

describe("the Changes window", () => {
  it("shows a folder tree that collapses and expands; the switch makes it a flat list", () => {
    mount();
    const tree = within(screen.getByRole("tree", { name: "Changed files" }));
    expect(tree.getByText("src")).toBeTruthy();
    expect(tree.getByText("v3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(tree.queryByText("a.ts")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
    expect(tree.getByText("a.ts")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Collapse src" }));
    expect(tree.queryByText("c.ts")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show as a flat list" }));
    expect(screen.getByRole("tree").textContent).toContain("src/lib/");
    expect((screen.getByRole("button", { name: "Collapse all" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("acts on the checked files only; a folder's box checks everything under it", () => {
    const onRun = mount();
    fireEvent.click(screen.getByLabelText("Include src/v3"));
    fireEvent.click(screen.getByRole("button", { name: /^Shelve 2 files/ }));
    fireEvent.change(screen.getByPlaceholderText("What this is"), { target: { value: "later" } });
    fireEvent.click(screen.getByRole("button", { name: "Shelve" }));
    expect(onRun).toHaveBeenLastCalledWith({ op: "shelve", files: ["src/lib/c.ts", "README.md"], message: "later" });
  });

  it("Rollback asks first and names what is lost", () => {
    const onRun = mount();
    fireEvent.click(screen.getByRole("button", { name: /^Roll back 4 files/ }));
    expect(screen.getByText(/Their changes are lost/)).toBeTruthy();
    expect(onRun).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Roll back" }));
    expect(onRun).toHaveBeenLastCalledWith({ op: "rollback", files: files.map((f) => f.path) });
  });

  it("Stash lists git's stashes with Apply, Pop and Drop (Drop asks first)", () => {
    const onRun = mount({ stashes: [{ ref: "stash@{0}", message: "try", ago: "2h ago", files: 3, branch: "main" }] });
    fireEvent.click(screen.getByRole("radio", { name: /^Stash 1/ }));
    expect(screen.getByText("stash@{0} · 3 files · 2h ago · on main")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pop" }));
    expect(onRun).toHaveBeenLastCalledWith({ op: "stash-pop", ref: "stash@{0}" });
    fireEvent.click(screen.getByRole("button", { name: "Drop" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onRun).toHaveBeenLastCalledWith({ op: "stash-drop", ref: "stash@{0}" });
  });

  it("without git: Stash is off and says why; the first snapshot is the base", () => {
    const onRun = mount({ files: [], source: { kind: "local", snapshot: null }, shelves: [] });
    expect(screen.getByRole("radio", { name: /^Stash/ }).getAttribute("aria-disabled") ?? (screen.getByRole("radio", { name: /^Stash/ }) as HTMLButtonElement).disabled.toString()).toMatch(/true/);
    expect(screen.getByText(/^Not a git repository. Agent Switch can keep local snapshots/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Take snapshot" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Take snapshot" }).at(-1)!);
    expect(onRun).toHaveBeenLastCalledWith({ op: "snapshot", message: "" });
  });

  it("Shelf: unshelve puts an entry back; without a runner every action says it arrives later", () => {
    const onRun = mount({ shelves: [{ id: "x1", message: "wip", ago: "5m ago", files: 2, kind: "git" }] });
    fireEvent.click(screen.getByRole("radio", { name: /^Shelf 1/ }));
    fireEvent.click(screen.getByRole("button", { name: "Unshelve" }));
    expect(onRun).toHaveBeenLastCalledWith({ op: "unshelve", id: "x1" });
    cleanup();
    render(<ChangesWindow files={files} onReview={vi.fn()} onCommit={vi.fn()} onHide={vi.fn()} reviewAvailable />);
    expect((screen.getByRole("button", { name: /^Shelve/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
