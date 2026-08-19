import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

import {
  ReleaseNotes,
  ReleaseNotesStack,
  groupBlocks,
  splitItemLead,
  formatPublishedAt,
} from "./ReleaseNotes.js";
import { releaseNoteBlocks } from "./release-notes.js";
import type { ReleaseInfo } from "./updates.js";

beforeEach(() => cleanup());

/**
 * A body shaped like the release template's real output. Not read from
 * `tests/fixtures/` on disk on purpose: this project has no `@types/node` (it is
 * a browser bundle), so a `node:fs` import here typechecks only where a parent
 * `node_modules/@types/node` is reachable — true in a checkout, false in CI's
 * gui-scoped `npm ci`. The captured 14.2.0 body is asserted in the CLI mirror's
 * test; `tests/release-notes.test.ts` byte-compares the two mirror sources.
 */
const TEMPLATE_BODY = [
  "### Release highlights",
  "",
  "<!-- Curated head: fill before merge. -->",
  "- **Behaviour changes:** _none_",
  "- **Security and correctness:** tenant scope on exports",
  "",
  "### Bug Fixes",
  "",
  "* **ci:** serialize the two publish triggers ([bbb60a8](https://github.com/o/r/commit/bbb60a895b65))",
].join("\n");

const release = (over: Partial<ReleaseInfo> = {}): ReleaseInfo => ({
  tag: "14.2.0",
  name: "14.2.0",
  url: "https://github.com/event4u-app/agent-config/releases/tag/14.2.0",
  notes: "### Features\n\n* **hooks:** stop pointing at bare skills\n",
  publishedAt: "2026-08-18T16:47:49Z",
  ...over,
});

describe("pure helpers", () => {
  it("splitItemLead lifts a short scope prefix and leaves prose alone", () => {
    expect(splitItemLead("hooks: stop pointing at bare skills")).toEqual({
      lead: "hooks",
      rest: "stop pointing at bare skills",
    });
    // A sentence that merely contains a colon keeps its shape.
    expect(splitItemLead("this is a long sentence that happens to have: a colon")).toEqual({
      lead: null,
      rest: "this is a long sentence that happens to have: a colon",
    });
    expect(splitItemLead("no colon here")).toEqual({ lead: null, rest: "no colon here" });
  });

  it("formatPublishedAt returns null rather than 'Invalid Date'", () => {
    expect(formatPublishedAt("")).toBeNull();
    expect(formatPublishedAt("not-a-date")).toBeNull();
    expect(formatPublishedAt("2026-08-18T16:47:49Z")).toBeTruthy();
  });

  it("groupBlocks merges consecutive items into one list", () => {
    const grouped = groupBlocks(releaseNoteBlocks("### A\n\n* one\n* two\n\ntext\n\n* three\n"));
    expect(grouped.map((g) => (Array.isArray(g) ? `list(${g.length})` : g.kind))).toEqual([
      "heading",
      "list(2)",
      "text",
      "list(1)",
    ]);
  });
});

describe("ReleaseNotes", () => {
  it("renders a titled, dated disclosure with the normalised body", () => {
    render(<ReleaseNotes release={release()} onOpenUrl={vi.fn()} />);
    expect(screen.getByText(/what's new in 14\.2\.0/i)).toBeTruthy();
    expect(screen.getByText("Features")).toBeTruthy();
    expect(screen.getByText("stop pointing at bare skills")).toBeTruthy();
    expect(screen.getByText("hooks:")).toBeTruthy();
  });

  it("is collapsed by default and opens when asked", () => {
    render(<ReleaseNotes release={release()} onOpenUrl={vi.fn()} />);
    expect(screen.getByTestId("release-notes").hasAttribute("open")).toBe(false);
    cleanup();
    render(<ReleaseNotes release={release()} defaultOpen onOpenUrl={vi.fn()} />);
    expect(screen.getByTestId("release-notes").hasAttribute("open")).toBe(true);
  });

  it("renders NOTHING when the body normalises to nothing (empty / comment-only)", () => {
    render(<ReleaseNotes release={release({ notes: "" })} onOpenUrl={vi.fn()} />);
    expect(screen.queryByTestId("release-notes")).toBeNull();
    cleanup();
    render(<ReleaseNotes release={release({ notes: "<!-- author note -->" })} onOpenUrl={vi.fn()} />);
    expect(screen.queryByTestId("release-notes")).toBeNull();
  });

  it("opens the release page through the injected handler, never a raw anchor", () => {
    const onOpenUrl = vi.fn();
    render(<ReleaseNotes release={release()} defaultOpen onOpenUrl={onOpenUrl} />);
    fireEvent.click(screen.getByRole("button", { name: /full release notes on github/i }));
    expect(onOpenUrl).toHaveBeenCalledWith(release().url);
  });

  it("falls back to the tag when the release has no name", () => {
    render(<ReleaseNotes release={release({ name: "" })} onOpenUrl={vi.fn()} />);
    expect(screen.getByText(/what's new in 14\.2\.0/i)).toBeTruthy();
  });

  it("shows a template-shaped body with no template noise", () => {
    const { container } = render(
      <ReleaseNotes release={release({ notes: TEMPLATE_BODY })} defaultOpen onOpenUrl={vi.fn()} />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Release highlights");
    expect(text).toContain("Behaviour changes");
    expect(text).not.toContain("Curated head"); // the HTML comment
    expect(text).not.toContain("**");
    expect(text).not.toContain("_none_");
    expect(text).not.toMatch(/\/commit\//);
  });
});

describe("ReleaseNotesStack", () => {
  const r = (tag: string, notes = `### Fixes\n\n* **x:** fix in ${tag}\n`) => release({ tag, name: tag, notes });

  it("renders one disclosure per unread release, newest expanded", () => {
    render(<ReleaseNotesStack releases={[r("14.2.0"), r("14.1.0")]} defaultOpen onOpenUrl={vi.fn()} />);
    const items = screen.getAllByTestId("release-notes");
    expect(items.map((el) => el.getAttribute("data-tag"))).toEqual(["14.2.0", "14.1.0"]);
    expect(items[0].hasAttribute("open")).toBe(true);
    expect(items[1].hasAttribute("open")).toBe(false);
  });

  it("skips releases with an empty body and renders nothing when all are empty", () => {
    render(<ReleaseNotesStack releases={[r("14.2.0", ""), r("14.1.0")]} onOpenUrl={vi.fn()} />);
    expect(screen.getAllByTestId("release-notes").map((el) => el.getAttribute("data-tag"))).toEqual(["14.1.0"]);
    cleanup();
    render(<ReleaseNotesStack releases={[r("14.2.0", ""), r("14.1.0", "<!-- x -->")]} onOpenUrl={vi.fn()} />);
    expect(screen.queryByTestId("release-notes-stack")).toBeNull();
  });

  it("renders nothing for an empty list (offline / rate-limited)", () => {
    render(<ReleaseNotesStack releases={[]} onOpenUrl={vi.fn()} />);
    expect(screen.queryByTestId("release-notes-stack")).toBeNull();
  });
});
