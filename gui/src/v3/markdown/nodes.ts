/** The tree the chat renders agent markdown from (roadmap road-to-a-chat-that-reads-well
 *  2.3). Only these shapes reach React: no parser token, no element name, no
 *  attribute taken from the input. */

import type { DiffHunk } from "../timeline.js";

export type Inline =
  | { t: "text"; v: string }
  | { t: "code"; v: string }
  | { t: "strong" | "em" | "del"; c: Inline[] }
  /** `href` has passed `safeHref`: an absolute http(s) URL. */
  | { t: "link"; href: string; c: Inline[] }
  | { t: "br" };

export type Align = "left" | "center" | "right" | null;

export interface ListItem {
  /** null = not a task item; otherwise its checkbox state. */
  task: boolean | null;
  blocks: Block[];
}

export type Block =
  | { t: "p"; c: Inline[] }
  /** The inline run of a tight list item: no paragraph margin. */
  | { t: "span"; c: Inline[] }
  | { t: "h"; level: number; c: Inline[] }
  | { t: "list"; ordered: boolean; start: number; items: ListItem[] }
  | { t: "quote"; blocks: Block[] }
  | { t: "hr" }
  | { t: "table"; align: Align[]; head: Inline[][]; rows: Inline[][][] }
  | { t: "code"; lang: string; text: string }
  /** `numbered`: every hunk came with an `@@` header, so line numbers are real. */
  | { t: "diff"; lang: string; text: string; hunks: DiffHunk[]; numbered: boolean }
  /** `unclosed`: the source has no `</details>` for it (yet). */
  | { t: "details"; summary: Inline[] | null; blocks: Block[]; unclosed: boolean }
  /** Markup we do not render (other HTML): shown exactly as written. */
  | { t: "literal"; v: string };
