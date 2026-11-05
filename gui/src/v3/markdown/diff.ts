/** A ```diff fence → hunks for the chat's diff view. Line numbers only come from
 *  `@@ -a,b +c,d @@` headers; a body without them is shown unnumbered. Pure. */

import type { DiffHunk } from "../timeline.js";

const HEADER = /^(diff --git |index |--- |\+\+\+ |new file mode|deleted file mode|old mode|new mode|similarity index|rename from|rename to|Binary files)/;
const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parseDiffFence(text: string): { hunks: DiffHunk[]; numbered: boolean } | null {
  const hunks: DiffHunk[] = [];
  let numbered = true;
  let cur: DiffHunk | null = null;
  let inHeader = true;
  let changes = 0;
  for (const line of text.split("\n")) {
    const h = HUNK.exec(line);
    if (h) {
      cur = { oldStart: Number(h[1]), newStart: Number(h[2]), lines: [] };
      hunks.push(cur);
      inHeader = false;
      continue;
    }
    if (line.startsWith("diff --git ")) {
      inHeader = true;
      cur = null;
      continue;
    }
    if (inHeader && HEADER.test(line)) continue;
    if (line.startsWith("\\ ")) continue; // "\ No newline at end of file"
    inHeader = false;
    if (!cur) {
      cur = { oldStart: 1, newStart: 1, lines: [] };
      hunks.push(cur);
      numbered = false;
    }
    const k = line[0];
    if (k === "+" || k === "-") changes++;
    cur.lines.push(k === "+" || k === "-" || k === " " ? line : ` ${line}`);
  }
  if (!changes) return null;
  return { hunks: hunks.filter((x) => x.lines.length), numbered };
}
