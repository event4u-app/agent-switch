/**
 * What sits in a hosted agent's input line, read from its window with the
 * terminal's styling (`capture-pane -e`). Agent Switch types a message and
 * presses Enter only into an empty input: Enter submits everything there, so a
 * draft the user left would be sent along with it.
 *
 * Claude Code and Codex draw their input as the bottom-most line that starts
 * with a prompt mark (`>`, `›`, `❯`), optionally inside a box (`│`). An empty
 * input shows a placeholder drawn dimmed; the cursor is drawn in reverse video.
 * So the draft is the line's text after the mark that is neither dimmed nor
 * reverse, without the box's right edge.
 */

export interface PromptState {
  /** An input line was seen at all. */
  found: boolean;
  /** What the user typed there; "" when empty or only the placeholder shows. */
  draft: string;
}

const SGR = /\x1b\[([0-9;]*)m/g;
const OTHER_ESCAPE = /\x1b(?:\[[0-9;?]*[A-Za-z]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[()][A-Za-z0-9])/g;
const MARK = /^[\s│┃|]*[>›❯](?:\s|$)/;

const plain = (line: string) => line.replace(SGR, "").replace(OTHER_ESCAPE, "");

/** The characters of `line` that are drawn neither dimmed nor in reverse video. */
function typed(line: string): string {
  let dim = false;
  let reverse = false;
  let out = "";
  let at = 0;
  for (const m of line.matchAll(SGR)) {
    if (!dim && !reverse) out += line.slice(at, m.index);
    at = m.index! + m[0].length;
    const codes = m[1] === "" ? [0] : m[1].split(";").map(Number);
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      // 38/48;5;n and 38/48;2;r;g;b carry colour numbers that are not codes of their own.
      if (c === 38 || c === 48 || c === 58) i += codes[i + 1] === 5 ? 2 : codes[i + 1] === 2 ? 4 : 0;
      else if (c === 0) dim = reverse = false;
      else if (c === 2) dim = true;
      else if (c === 22) dim = false;
      else if (c === 7) reverse = true;
      else if (c === 27) reverse = false;
    }
  }
  if (!dim && !reverse) out += line.slice(at);
  return out.replace(OTHER_ESCAPE, "");
}

export function promptDraft(screen: string): PromptState {
  const lines = screen.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const mark = MARK.exec(plain(lines[i]));
    if (!mark) continue;
    // Drop the mark (and the box edge before it) from the styled line, then read what is typed.
    const visible = typed(lines[i]);
    const after = visible.replace(MARK, "");
    const draft = after.replace(/[│┃|]\s*$/, "").replace(/\s+/g, " ").trim();
    return { found: true, draft };
  }
  return { found: false, draft: "" };
}
