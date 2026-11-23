/**
 * What sits in a hosted agent's input, read from its window with the
 * terminal's styling (`capture-pane -e`). Agent Switch types a message and
 * presses Enter only into an empty input: Enter submits everything there, so a
 * draft the user left would be sent along with it.
 *
 * Claude Code and Codex draw their input starting at the bottom-most line that
 * starts with a prompt mark (`>`, `›`, `❯`), optionally inside a box (`│`).
 * A draft of several lines continues below it: up to the rule (`───`) Claude
 * Code draws under its input, or, without one, over the lines that follow
 * without a gap. An empty input shows a placeholder drawn dimmed; the cursor
 * is drawn in reverse video. So the draft is the input's text after the mark
 * that is not dimmed, without the box's edges; the cell under the cursor is
 * typed unless the placeholder goes on right after it.
 *
 * An open selection menu (a permission prompt, a question) draws its chosen
 * option with the same mark (`❯ 1. Yes`): that is a menu waiting for an
 * answer, not a draft.
 */

export interface PromptState {
  /** An input line (or a menu) was seen at all. */
  found: boolean;
  /** What the user typed there; "" when empty, when only the placeholder shows, or at a menu. */
  draft: string;
  /** A numbered selection menu is open: the agent waits for an answer there. */
  menu: boolean;
}

const SGR = /\x1b\[([0-9;]*)m/g;
const OTHER_ESCAPE = /\x1b(?:\[[0-9;?]*[A-Za-z]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[()][A-Za-z0-9])/g;
const MARK = /^[\s│┃|]*[>›❯](?:\s|$)/;
/** The rule under Claude Code's input, or a box's bottom edge. */
const RULE = /^\s*[╰└]?[─━]{3,}/;
/** A numbered option of a selection menu, after its mark or indented under it. */
const OPTION = /^\s*\d+\.\s/;

const plain = (line: string) => line.replace(SGR, "").replace(OTHER_ESCAPE, "");

/** The characters of `line` that are typed: not dimmed, and under the cursor only when no dimmed placeholder follows it. */
function typed(line: string): string {
  const runs: { text: string; dim: boolean; reverse: boolean }[] = [];
  let dim = false;
  let reverse = false;
  let at = 0;
  const push = (text: string) => {
    const t = text.replace(OTHER_ESCAPE, "");
    if (t) runs.push({ text: t, dim, reverse });
  };
  for (const m of line.matchAll(SGR)) {
    push(line.slice(at, m.index));
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
  push(line.slice(at));
  return runs
    .map((r, i) => {
      if (r.dim) return "";
      // The cursor sits on the placeholder's first letter when the dimmed rest follows at once.
      if (r.reverse && runs[i + 1]?.dim) return "";
      return r.text;
    })
    .join("");
}

const unboxed = (s: string) => s.replace(/^[\s│┃|]+/, "").replace(/[│┃|]\s*$/, "");
const words = (parts: string[]) => parts.join(" ").replace(/\s+/g, " ").trim();

export function promptDraft(screen: string): PromptState {
  const lines = screen.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const mark = MARK.exec(plain(lines[i]));
    if (!mark) continue;
    const first = typed(lines[i]).replace(MARK, "");
    // `❯ 1. Yes` with more numbered options around it: a selection menu.
    if (OPTION.test(plain(lines[i]).replace(MARK, "")) && lines.some((l, j) => j !== i && Math.abs(j - i) <= 8 && OPTION.test(unboxed(plain(l))))) return { found: true, draft: "", menu: true };
    // The lines of the same input below the mark: up to the rule under it, or the next gap without one.
    const below = lines.slice(i + 1);
    const rule = below.findIndex((l) => RULE.test(plain(l)));
    const rest = rule >= 0 ? below.slice(0, rule) : below.slice(0, below.findIndex((l) => !plain(l).trim()) >>> 0);
    return { found: true, draft: words([unboxed(first), ...rest.map((l) => unboxed(typed(l)))]), menu: false };
  }
  return { found: false, draft: "", menu: false };
}
