/**
 * Release-note normalisation — turn a GitHub release body into something a
 * card or a terminal can show without it reading as broken.
 *
 * Mirrored in `gui/src/release-notes.ts` (same boundary reason as updates.ts:
 * the GUI's tsconfig only includes `gui/src`, so pure helpers are duplicated
 * rather than imported across it). Both mirrors are tested against the SAME
 * captured fixture (`tests/fixtures/agent-config-release-14.2.0.md`), so the
 * one thing that must not drift — the input they claim to handle — cannot.
 *
 * Why a normaliser and not `body.slice(0, 500)`: measured on agent-config
 * 14.2.0, the first 500 characters are a heading, an HTML comment addressed to
 * the release author, and five `_none_` placeholders. The shapes handled here
 * are the ones that release template actually emits — headings, `*` items with
 * a `**scope:**` prefix, `([sha](commit-url))` suffixes, `**bold**` / `_italic_`
 * and horizontal rules. Everything is pure; no I/O, no markdown dependency.
 */

export type ReleaseNoteBlockKind = "heading" | "item" | "text";

export interface ReleaseNoteBlock {
  kind: ReleaseNoteBlockKind;
  text: string;
}

/** Drop HTML comments, including multi-line ones. This is what removes the
 *  release template's author-facing instruction line ("fill before merge …") —
 *  a comment is invisible on GitHub and must stay invisible here. */
export function stripHtmlComments(md: string): string {
  return String(md).replace(/<!--[\s\S]*?-->/g, "");
}

/** Inline cleanup applied to every line's text: commit-link suffixes go, real
 *  links collapse to their label, bold/italic markers are unwrapped, and runs
 *  of whitespace collapse. Inline code keeps its backticks on purpose — they
 *  mark a literal name, which is information, not noise. Pure. */
export function normalizeInline(s: string): string {
  return String(s)
    // ` ([abc1234](https://…/commit/abc…))` — the generated changelog's sha
    // suffix. Removed before generic link handling, which would otherwise
    // leave a bare `(abc1234)` behind.
    .replace(/\s*\(\[[0-9a-f]{7,40}\]\([^)\s]*\)\)/gi, "")
    // `[label](url)` → `label`
    .replace(/\[([^\]]*)\]\([^)\s]*\)/g, "$1")
    // `**bold**` / `__bold__` → bold
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    // `_italic_` → italic (this is what turns `_none_` into `none`).
    // Underscore-delimited only at word boundaries so `snake_case_names` and
    // `file_name.ts` survive untouched.
    .replace(/(^|[\s(])_([^_]+)_(?=[\s).,;:!?]|$)/g, "$1$2")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** True for a markdown horizontal rule (`---`, `***`, `___`). */
function isHorizontalRule(line: string): boolean {
  return /^\s*([-*_])\s*(\1\s*){2,}$/.test(line);
}

/**
 * Parse a release body into ordered blocks. Blank lines carry no block — the
 * renderers space by `kind` instead, so a body with erratic blank runs comes
 * out evenly spaced. An empty or comment-only body yields `[]`, which every
 * caller must treat as "no notes" (render nothing — never a placeholder).
 */
export function releaseNoteBlocks(md: string): ReleaseNoteBlock[] {
  const blocks: ReleaseNoteBlock[] = [];
  for (const raw of stripHtmlComments(md).split(/\r?\n/)) {
    if (!raw.trim() || isHorizontalRule(raw)) continue;

    const heading = /^\s*#{1,6}\s+(.*)$/.exec(raw);
    if (heading) {
      const text = normalizeInline(heading[1]);
      if (text) blocks.push({ kind: "heading", text });
      continue;
    }

    const item = /^\s*[-*+]\s+(.*)$/.exec(raw);
    if (item) {
      const text = normalizeInline(item[1]);
      if (text) blocks.push({ kind: "item", text });
      continue;
    }

    const text = normalizeInline(raw);
    if (text) blocks.push({ kind: "text", text });
  }
  return blocks;
}

/** A `_none_`-style empty value — the release template's way of saying "this
 *  section genuinely has nothing", which must not be offered as a highlight. */
function isEmptyValue(value: string): boolean {
  return /^(none|n\/a|-|—)$/i.test(value.trim());
}

/**
 * The one line worth putting in a notification: the first non-empty bullet
 * under a "highlights"-ish heading, else the first bullet in the body. Returns
 * null when the body carries no bullet with content — callers then say nothing
 * rather than inventing a summary. Pure.
 */
export function firstHighlight(blocks: readonly ReleaseNoteBlock[]): string | null {
  const start = blocks.findIndex((b) => b.kind === "heading" && /highlight/i.test(b.text));
  const scan = (from: number, stopAtHeading: boolean): string | null => {
    for (let i = from; i < blocks.length; i++) {
      const b = blocks[i];
      if (b.kind === "heading" && stopAtHeading && i > from) return null;
      if (b.kind !== "item") continue;
      // `Behaviour changes: none` → value `none`; a bullet with no colon is
      // its own value.
      const colon = b.text.indexOf(":");
      const value = colon >= 0 ? b.text.slice(colon + 1) : b.text;
      if (!isEmptyValue(value)) return b.text;
    }
    return null;
  };
  return start >= 0 ? (scan(start + 1, true) ?? scan(0, false)) : scan(0, false);
}

export interface ReleaseNotesTextOptions {
  /** Hard cap on emitted lines; the remainder is reported as `omitted`. */
  maxLines?: number;
  /** Bullet glyph for `item` blocks (ASCII fallback for dumb terminals). */
  bullet?: string;
  /** Left pad applied to every line. */
  indent?: string;
}

/**
 * Render blocks as terminal lines: a blank line before each heading (never as
 * the first line), items bulleted, text as-is. `omitted` is how many lines the
 * cap dropped, so the caller can print an honest "… N more" plus the release
 * URL instead of silently truncating. Pure.
 */
export function releaseNotesText(
  blocks: readonly ReleaseNoteBlock[],
  opts: ReleaseNotesTextOptions = {},
): { lines: string[]; omitted: number } {
  const bullet = opts.bullet ?? "•";
  const indent = opts.indent ?? "";
  const all: string[] = [];
  for (const b of blocks) {
    if (b.kind === "heading") {
      if (all.length) all.push("");
      all.push(`${indent}${b.text}`);
    } else if (b.kind === "item") {
      all.push(`${indent}  ${bullet} ${b.text}`);
    } else {
      all.push(`${indent}  ${b.text}`);
    }
  }
  const max = opts.maxLines;
  if (max === undefined || all.length <= max) return { lines: all, omitted: 0 };
  return { lines: all.slice(0, max), omitted: all.length - max };
}

/** Clamp to `max` characters on a word boundary, appending an ellipsis when
 *  anything was cut. Used for the one-line notification summary, where a raw
 *  bullet can run to several hundred characters. Pure. */
export function clampText(s: string, max: number): string {
  const t = String(s).trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const space = cut.lastIndexOf(" ");
  // Prefer the word boundary, but only when it still keeps at least half the
  // budget — otherwise a long first word would collapse the summary to nothing.
  return `${(space > max * 0.5 ? cut.slice(0, space) : cut).replace(/[\s,;:.\-]+$/, "")}…`;
}
