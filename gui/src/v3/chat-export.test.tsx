import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import fx from "./fixtures/timeline-claude-2.1.316.json";
import { ChatTimeline } from "./chat.js";
import { sessionMarkdown } from "./chat-export.js";
import { parseMarkdown } from "./markdown/parse.js";
import { fold, type AsEvent, type ChatRow } from "./timeline.js";

afterEach(cleanup);

describe("sessionMarkdown (3.1)", () => {
  it("the recorded session: every message's source text, tools in order, the edit as a diff fence", () => {
    const rows = fold(fx.transcript as AsEvent[]).rows;
    const md = sessionMarkdown(rows, "notes demo");
    expect(md.startsWith("# notes demo\n\n### You\n\n")).toBe(true);
    for (const r of rows) if (r.k === "user" || r.k === "assistant") expect(md).toContain(r.text);
    expect(md).toContain("```diff\n--- a/");
    expect(md).toMatch(/^-alpha$/m);
    expect(md).toMatch(/^\+beta$/m);
    // Read back by our own renderer it is well-formed markdown: the diff fence parses as a diff.
    expect(parseMarkdown(md).some((b) => b.t === "diff")).toBe(true);
  });

  it("a fence inside a diff cannot close the export's fence", () => {
    const rows: ChatRow[] = [{ k: "tool", id: "t", name: "Edit", summary: "README.md", state: "ok", result: null, diffs: [{ path: "README.md", added: 1, removed: 0, hunks: [{ oldStart: 1, newStart: 1, lines: ["+```ts", "+x", "+```"] }] }] }];
    const md = sessionMarkdown(rows);
    expect(md).toContain("````diff\n");
    const tree = parseMarkdown(md);
    expect(tree.filter((b) => b.t === "diff")).toHaveLength(1);
  });

  it("each row kind has a line, nothing is dropped", () => {
    const rows: ChatRow[] = [
      { k: "user", id: "1", text: "hi", images: 2 },
      { k: "subagent", id: "2", type: "general-purpose", description: "list files", state: "failed", agentId: null },
      { k: "approval", id: "3", tool: "Bash", summary: "rm `x`", resolved: "deny" },
      { k: "question", id: "4", questions: [{ question: "Which?", options: ["a", "b"] }] },
      { k: "plan", id: "5", text: "1. do it" },
      { k: "error", id: "6", message: "boom" },
    ];
    const md = sessionMarkdown(rows);
    for (const s of ["_(2 images)_", "**Task** (general-purpose) list files (failed)", "**Approval** Bash: `rm 'x'` — denied", "**Question:** Which? (a / b)", "**Plan**\n\n1. do it", "> **Error:** boom"]) expect(md).toContain(s);
  });
});

describe("Copy conversation button", () => {
  it("writes the session markdown to the clipboard and confirms", async () => {
    const writeText = vi.fn(async (_t: string) => {});
    Object.assign(navigator, { clipboard: { writeText } });
    render(<ChatTimeline events={fx.transcript as AsEvent[]} />);
    await act(async () => void fireEvent.click(screen.getByLabelText("Copy conversation")));
    expect(writeText).toHaveBeenCalledWith(sessionMarkdown(fold(fx.transcript as AsEvent[]).rows));
    expect(screen.getByLabelText("Copied")).toBeTruthy();
  });

  it("no bar on an empty session, and none when the caller puts the button in its own header", () => {
    render(<ChatTimeline events={[]} />);
    expect(screen.queryByLabelText("Copy conversation")).toBeNull();
    cleanup();
    render(<ChatTimeline copyBar={false} events={fx.transcript as AsEvent[]} />);
    expect(screen.queryByLabelText("Copy conversation")).toBeNull();
  });
});
