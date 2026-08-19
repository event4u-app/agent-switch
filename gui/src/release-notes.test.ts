import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  stripHtmlComments,
  normalizeInline,
  releaseNoteBlocks,
  firstHighlight,
  releaseNotesText,
  clampText,
} from "./release-notes.js";

/** The SAME captured fixture the CLI mirror's test reads
 *  (`tests/release-notes.test.ts`) — one input, two mirrors, so the pair cannot
 *  drift on the shape they claim to handle. Resolved by walking up so the path
 *  holds regardless of where the runner is invoked from. */
const FIXTURE_REL = path.join("tests", "fixtures", "agent-config-release-14.2.0.md");
function fixturePath(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, FIXTURE_REL);
    if (fs.existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  throw new Error(`fixture not found walking up from ${fileURLToPath(import.meta.url)}: ${FIXTURE_REL}`);
}
const FIXTURE = fs.readFileSync(fixturePath(), "utf8");

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

  it("renders the real 14.2.0 body without comment, sha or emphasis noise", () => {
    const blocks = releaseNoteBlocks(FIXTURE);
    const joined = blocks.map((b) => b.text).join("\n");
    expect(blocks.length).toBeGreaterThan(10);
    expect(joined).not.toContain("<!--");
    expect(joined).not.toContain("Curated head");
    expect(joined).not.toContain("**");
    expect(joined).not.toContain("_none_");
    expect(joined).not.toMatch(/\/commit\//);
    expect(joined).toContain("Behaviour changes: none");
    expect(blocks[0]).toEqual({ kind: "heading", text: "Release highlights" });
  });

  it("picks the first non-placeholder highlight from the real body", () => {
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
