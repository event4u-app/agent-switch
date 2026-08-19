import { test } from "node:test";
import assert from "node:assert/strict";
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
} from "../src/release-notes.js";

/** The REAL agent-config 14.2.0 release body, captured verbatim. Asserting
 *  against a synthetic sample would test the parser against its own author's
 *  imagination; this is the shape that actually ships. The GUI mirror's test
 *  reads the same file, so the mirrors cannot drift on their input.
 *
 *  Resolved by walking UP from this file: the suite compiles into `dist-test/`
 *  and runs from there, so a sibling `fixtures/` lookup would silently miss and
 *  the assertions below would vanish rather than fail. A missing fixture throws. */
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

test("stripHtmlComments removes single- and multi-line comments", () => {
  assert.equal(stripHtmlComments("a <!-- x --> b"), "a  b");
  assert.equal(stripHtmlComments("a <!-- x\ny\n--> b"), "a  b");
  assert.equal(stripHtmlComments("no comment"), "no comment");
});

test("normalizeInline drops the generated commit-sha suffix", () => {
  const line = "**hooks:** stop pointing at bare skills ([508bba9](https://github.com/o/r/commit/508bba908e07))";
  assert.equal(normalizeInline(line), "hooks: stop pointing at bare skills");
});

test("normalizeInline collapses real links to their label and unwraps emphasis", () => {
  assert.equal(normalizeInline("see [the docs](https://example.com/x)"), "see the docs");
  assert.equal(normalizeInline("**Behaviour changes:** _none_"), "Behaviour changes: none");
  assert.equal(normalizeInline("__bold__ and _italic_ here"), "bold and italic here");
});

test("normalizeInline leaves snake_case, file names and inline code alone", () => {
  // Underscore emphasis is word-boundary bound, so identifiers survive; the
  // backticks stay because a literal name IS information, not noise.
  assert.equal(normalizeInline("`agent_config_dir` and file_name.ts"), "`agent_config_dir` and file_name.ts");
});

test("releaseNoteBlocks classifies headings, items and prose; skips blanks and rules", () => {
  const blocks = releaseNoteBlocks("### Features\n\n* **a:** one\n\nplain text\n\n---\n");
  assert.deepEqual(blocks, [
    { kind: "heading", text: "Features" },
    { kind: "item", text: "a: one" },
    { kind: "text", text: "plain text" },
  ]);
});

test("releaseNoteBlocks on an empty or comment-only body yields no blocks", () => {
  assert.deepEqual(releaseNoteBlocks(""), []);
  assert.deepEqual(releaseNoteBlocks("<!-- author instructions only -->\n\n"), []);
});

test("the real 14.2.0 body renders with no comment, sha or emphasis noise", () => {
  const blocks = releaseNoteBlocks(FIXTURE);
  assert.ok(blocks.length > 10, `expected a populated body, got ${blocks.length} blocks`);
  const joined = blocks.map((b) => b.text).join("\n");
  assert.ok(!joined.includes("<!--"), "HTML comment leaked into the output");
  assert.ok(!joined.includes("Curated head"), "the author-facing instruction line leaked");
  assert.ok(!joined.includes("**"), "bold markers leaked");
  assert.ok(!/\/commit\//.test(joined), "commit URLs leaked");
  assert.ok(!joined.includes("_none_"), "italic markers leaked");
  // The curated head's own bullets survive, with their values readable.
  assert.ok(joined.includes("Behaviour changes: none"), joined.slice(0, 200));
  assert.equal(blocks[0].kind, "heading");
  assert.equal(blocks[0].text, "Release highlights");
});

test("firstHighlight skips `none` placeholders and returns the first real one", () => {
  const blocks = releaseNoteBlocks(FIXTURE);
  const h = firstHighlight(blocks);
  assert.ok(h, "expected a highlight from the 14.2.0 body");
  assert.ok(h.startsWith("Security and correctness:"), h);
});

test("firstHighlight falls back to the first bullet when no highlights section exists", () => {
  const blocks = releaseNoteBlocks("### Features\n\n* **a:** one\n* b\n");
  assert.equal(firstHighlight(blocks), "a: one");
});

test("firstHighlight is null when every bullet is an empty placeholder", () => {
  assert.equal(firstHighlight(releaseNoteBlocks("### Highlights\n\n- **x:** _none_\n- **y:** n/a\n")), null);
  assert.equal(firstHighlight(releaseNoteBlocks("just prose, no bullets")), null);
});

test("releaseNotesText bullets items, blank-lines before headings, never leads blank", () => {
  const blocks = releaseNoteBlocks("### Features\n\n* one\n\n### Fixes\n\n* two\n");
  const { lines, omitted } = releaseNotesText(blocks);
  assert.deepEqual(lines, ["Features", "  • one", "", "Fixes", "  • two"]);
  assert.equal(omitted, 0);
});

test("releaseNotesText reports what the cap dropped instead of truncating silently", () => {
  const blocks = releaseNoteBlocks("* a\n* b\n* c\n* d\n");
  const { lines, omitted } = releaseNotesText(blocks, { maxLines: 2 });
  assert.deepEqual(lines, ["  • a", "  • b"]);
  assert.equal(omitted, 2);
});

test("releaseNotesText honours a custom bullet and indent", () => {
  const { lines } = releaseNotesText(releaseNoteBlocks("* a"), { bullet: "-", indent: "    " });
  assert.deepEqual(lines, ["      - a"]);
});

test("clampText cuts on a word boundary and marks the cut", () => {
  assert.equal(clampText("short enough", 40), "short enough");
  assert.equal(clampText("one two three four five", 12), "one two…");
  // No usable space near the limit → hard cut rather than losing most of it.
  assert.equal(clampText("aaaaaaaaaaaaaaaaaaaa", 8), "aaaaaaaa…");
  assert.equal(clampText("  padded  ", 40), "padded");
});

// ---------- the mirror contract ----------
//
// `src/release-notes.ts` and `gui/src/release-notes.ts` are the same module
// twice, because the GUI tsconfig includes only `gui/src` and cannot import
// across that boundary. Two guards keep the duplication honest, and both live
// HERE: this suite is the one that legitimately has Node types.

function repoFile(rel: string): string {
  // Walk up: the suite compiles into `dist-test/` and runs from there, so a
  // path relative to this file would miss the repo root.
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, rel);
    if (fs.existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  throw new Error(`not found walking up from ${fileURLToPath(import.meta.url)}: ${rel}`);
}

/** Everything after the leading block comment — the header is the one part
 *  allowed to differ (each mirror names the other one). */
function bodyAfterHeader(source: string): string {
  const end = source.indexOf("*/");
  return end === -1 ? source : source.slice(end + 2).trim();
}

test("the two release-notes mirrors are byte-identical below their header", () => {
  const cli = fs.readFileSync(repoFile(path.join("src", "release-notes.ts")), "utf8");
  const gui = fs.readFileSync(repoFile(path.join("gui", "src", "release-notes.ts")), "utf8");
  // Stronger than testing both against one shared fixture: a fix applied to one
  // mirror and not the other fails here, whatever the inputs happen to cover.
  assert.equal(
    bodyAfterHeader(gui),
    bodyAfterHeader(cli),
    "gui/src/release-notes.ts drifted from src/release-notes.ts — copy the change across",
  );
});

test("no gui/src file imports a node: builtin", () => {
  // The GUI is a browser bundle: its tsconfig carries `types: ["vitest/globals"]`
  // and no `@types/node`, so `import … from "node:fs"` typechecks in a full
  // checkout (TS walks up to the ROOT node_modules/@types/node) and fails in
  // CI, which installs inside `gui/` only. That asymmetry cost a red CI run on
  // two files at once, so it is asserted rather than remembered.
  const dir = repoFile(path.join("gui", "src"));
  const offenders: string[] = [];
  const walk = (d: string): void => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(entry.name) && /from\s+["']node:/.test(fs.readFileSync(p, "utf8"))) {
        offenders.push(path.relative(dir, p));
      }
    }
  };
  walk(dir);
  assert.deepEqual(offenders, [], `gui/src must not import node: builtins — found in ${offenders.join(", ")}`);
});
