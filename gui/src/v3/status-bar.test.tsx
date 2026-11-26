/** The status bar under the chat (owner, 2026-11-26): project, the folder the agent runs in, branch. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { StatusBar, tildePath } from "./workbench.js";
import { V3Window } from "./window.js";
import { data, slots } from "./window-fixture.js";

afterEach(cleanup);

describe("the session status bar", () => {
  it("shows the home folder as ~", () => {
    expect(tildePath("/Users/matze/Projects/as")).toBe("~/Projects/as");
    expect(tildePath("/home/dev/x", null)).toBe("~/x");
    expect(tildePath("/srv/app")).toBe("/srv/app");
    expect(tildePath("/opt/me/a", "/opt/me")).toBe("~/a");
  });

  it("names the project, the working folder (copied on click) and the branch with its worktree mark", () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    render(<StatusBar place={{ cwd: "/Users/m/p/as/.worktrees/x", project: "agent-switch", projectRoot: "/Users/m/p/as", branch: "feat/x", worktree: true, changed: 2, ahead: 1, behind: 0 }} />);
    const bar = within(screen.getByRole("contentinfo", { name: "Session status" }));
    expect(bar.getByText("agent-switch")).toBeTruthy();
    expect(bar.getByText("~/p/as/.worktrees/x")).toBeTruthy();
    expect(bar.getByText("feat/x")).toBeTruthy();
    expect(bar.getByText("worktree")).toBeTruthy();
    expect(bar.getByText("↑1")).toBeTruthy();
    expect(bar.queryByText(/↓/)).toBeNull();
    expect(bar.getByText("2 changed")).toBeTruthy();
    fireEvent.click(bar.getByRole("button", { name: /copy path/ }));
    expect(writeText).toHaveBeenCalledWith("/Users/m/p/as/.worktrees/x");
  });

  it("sits under an open session, not under a page", () => {
    const d = data();
    const bar = d.bar;
    render(<V3Window data={{ ...d, bar: (k) => ({ ...bar(k)!, place: { cwd: "/home/u/repo", project: "repo", branch: "main" } }) }} slots={slots} act={vi.fn()} />);
    fireEvent.click(within(screen.getByLabelText("Sessions window")).getByText("Event store"));
    expect(screen.getByRole("contentinfo", { name: "Session status" }).textContent).toContain("~/repo");
    fireEvent.click(screen.getByLabelText(/^Settings/));
    expect(screen.queryByRole("contentinfo", { name: "Session status" })).toBeNull();
  });
});
