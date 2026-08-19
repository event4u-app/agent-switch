import { describe, expect, it } from "vitest";

import {
  stripHtmlComments,
  normalizeInline,
  releaseNoteBlocks,
  firstHighlight,
  releaseNotesText,
  clampText,
} from "./release-notes.js";

/**
 * A sample carrying every noisy construct agent-config's release template
 * actually emits — curated highlights head, the author-facing HTML comment,
 * `**bold**` scope prefixes, `_none_` placeholders, generated `([sha](url))`
 * suffixes, a horizontal rule, trailing prose.
 *
 * Deliberately NOT read from `tests/fixtures/` on disk: this project compiles
 * with `types: ["vitest/globals"]` and `lib: [ES2022, DOM]` — no `@types/node`
 * — because it is a browser bundle. Importing `node:fs` here typechecks only
 * where a parent `node_modules/@types/node` happens to be reachable, which is
 * true in a full checkout and false in CI's `working-directory: gui` +
 * `npm ci`. The real captured body is asserted in the CLI mirror's test, and
 * `tests/release-notes.test.ts` byte-compares the two mirror sources — a
 * stronger guarantee than a shared input, since it makes the implementations
 * themselves unable to drift.
 */
const FIXTURE = [
  "### Release highlights",
  "",
  "<!-- Curated head: fill before merge, keep it under 10 lines. -->",
  "- **Behaviour changes:** _none_",
  "- **Default changes + migration:** _none_",
  "- **Security and correctness:** tenant scope on exports",
  "",
  "### Features",
  "",
  "* **hooks:** stop skill-route pointing at bare skills ([508bba9](https://github.com/o/r/commit/508bba908e07))",
  "",
  "### Bug Fixes",
  "",
  "* **ci:** serialize the two publish triggers ([bbb60a8](https://github.com/o/r/commit/bbb60a895b65))",
  "",
  "Tests: 14629 (+37 since 14.1.0)",
  "",
  "---",
  "**MCP Worker deployed:** `v14.2.0-53e0661`",
].join("\n");

describe("release-note normalisation (GUI mirror of the CLI release-notes module)", () => {
  it("removes single- and multi-line HTML comments", () => {
    expect(stripHtmlComments("a <!-- x --> b")).toBe("a  b");
    expect(stripHtmlComments("a <!-- x\ny\n--> b")).toBe("a  b");
  });

  it("drops the generated commit-sha suffix", () => {
    const line = "**hooks:** stop pointing at bare skills ([508bba9](https://github.com/o/r/commit/508bba908e07))";
    expect(normalizeInline(line)).toBe("hooks: stop pointing at bare skills");
  });

  it("collapses links to their label and unwraps emphasis", () => {
    expect(normalizeInline("see [the docs](https://example.com/x)")).toBe("see the docs");
    expect(normalizeInline("**Behaviour changes:** _none_")).toBe("Behaviour changes: none");
  });

  it("leaves snake_case identifiers and inline code alone", () => {
    expect(normalizeInline("`agent_config_dir` and file_name.ts")).toBe("`agent_config_dir` and file_name.ts");
  });

  it("classifies headings, items and prose and skips blanks/rules", () => {
    expect(releaseNoteBlocks("### Features\n\n* **a:** one\n\nplain\n\n---\n")).toEqual([
      { kind: "heading", text: "Features" },
      { kind: "item", text: "a: one" },
      { kind: "text", text: "plain" },
    ]);
  });

  it("yields no blocks for an empty or comment-only body (→ render nothing)", () => {
    expect(releaseNoteBlocks("")).toEqual([]);
    expect(releaseNoteBlocks("<!-- author instructions only -->\n")).toEqual([]);
  });

  it("renders a template-shaped body without comment, sha or emphasis noise", () => {
    const blocks = releaseNoteBlocks(FIXTURE);
    const joined = blocks.map((b) => b.text).join("\n");
    // The sample's shape, spelled out: 3 section headings, 5 bullets, 2 trailing
    // prose lines. The comment and the horizontal rule contribute nothing.
    expect({
      heading: blocks.filter((b) => b.kind === "heading").length,
      item: blocks.filter((b) => b.kind === "item").length,
      text: blocks.filter((b) => b.kind === "text").length,
    }).toEqual({ heading: 3, item: 5, text: 2 });
    expect(joined).not.toContain("<!--");
    expect(joined).not.toContain("Curated head");
    expect(joined).not.toContain("**");
    expect(joined).not.toContain("_none_");
    expect(joined).not.toMatch(/\/commit\//);
    expect(joined).toContain("Behaviour changes: none");
    expect(blocks[0]).toEqual({ kind: "heading", text: "Release highlights" });
  });

  it("picks the first non-placeholder highlight", () => {
    const h = firstHighlight(releaseNoteBlocks(FIXTURE));
    expect(h).toMatch(/^Security and correctness:/);
  });

  it("returns null when every bullet is a placeholder or there are none", () => {
    expect(firstHighlight(releaseNoteBlocks("### Highlights\n\n- **x:** _none_\n"))).toBeNull();
    expect(firstHighlight(releaseNoteBlocks("prose only"))).toBeNull();
  });

  it("renders terminal lines with a blank line before each heading but never first", () => {
    const { lines, omitted } = releaseNotesText(releaseNoteBlocks("### A\n\n* one\n\n### B\n\n* two\n"));
    expect(lines).toEqual(["A", "  • one", "", "B", "  • two"]);
    expect(omitted).toBe(0);
  });

  it("clamps a long summary on a word boundary and marks the cut", () => {
    expect(clampText("short enough", 40)).toBe("short enough");
    expect(clampText("one two three four five", 12)).toBe("one two…");
  });

  it("reports the dropped line count instead of truncating silently", () => {
    const { lines, omitted } = releaseNotesText(releaseNoteBlocks("* a\n* b\n* c\n"), { maxLines: 1 });
    expect(lines).toEqual(["  • a"]);
    expect(omitted).toBe(2);
  });
});
