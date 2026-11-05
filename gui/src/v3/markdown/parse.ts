/** Agent markdown → our tree (roadmap road-to-a-chat-that-reads-well 2.3; dialect in
 *  agents/evidence/markdown-corpus-2026-11.md). `marked` is the lexer only, on a
 *  private instance; no marked token leaves this file. Pure. */

import { Marked, type Token, type Tokens } from "marked";

import { parseDiffFence } from "./diff.js";
import { safeHref } from "./links.js";
import type { Align, Block, Inline, ListItem } from "./nodes.js";

const lexer = new Marked({ gfm: true, breaks: false });

export function parseMarkdown(source: string): Block[] {
  return blocks(lexer.lexer(source));
}

const BR = /^<br\s*\/?>$/i;
const OPEN = /^<details>$/i;
const CLOSE = /^<\/details>$/i;
const SUMMARY = /^<summary>(.*)<\/summary>$/i;

interface Frame {
  summary: Inline[] | null;
  blocks: Block[];
  /** A summary line may still become this frame's title. */
  awaitingSummary: boolean;
}

function details(f: Frame, unclosed: boolean): Block {
  return { t: "details", summary: f.summary, blocks: f.blocks, unclosed };
}

/** Block tokens → blocks, folding `<details>` tag lines into disclosures. */
function blocks(tokens: readonly Token[]): Block[] {
  const stack: Frame[] = [{ summary: null, blocks: [], awaitingSummary: false }];
  const top = () => stack[stack.length - 1]!;
  const push = (b: Block) => {
    top().blocks.push(b);
    top().awaitingSummary = false;
  };

  for (const tok of tokens) {
    if (tok.type === "space" || tok.type === "def") continue;
    if (tok.type !== "html") {
      const b = block(tok);
      if (b) push(b);
      continue;
    }
    // An HTML block: each line is a disclosure tag, or markdown to lex again.
    let rest: string[] = [];
    const flush = () => {
      if (!rest.length) return;
      const text = rest.join("\n");
      rest = [];
      if (stack.length === 1 && !(tok as Tokens.HTML).text.split("\n").some(isTagLine)) {
        push({ t: "literal", v: text });
        return;
      }
      for (const b of blocks(lexer.lexer(text))) push(b);
    };
    for (const line of (tok as Tokens.HTML).text.replace(/\n+$/, "").split("\n")) {
      const s = line.trim();
      if (OPEN.test(s)) {
        flush();
        stack.push({ summary: null, blocks: [], awaitingSummary: true });
        continue;
      }
      const sm = SUMMARY.exec(s);
      if (sm && stack.length > 1 && top().awaitingSummary && !rest.length) {
        top().summary = inlineOf(sm[1]!);
        top().awaitingSummary = false;
        continue;
      }
      if (CLOSE.test(s)) {
        flush();
        if (stack.length > 1) push(details(stack.pop()!, false));
        // Nothing open: the tag stays text (lexing it again would loop).
        else push({ t: "literal", v: line });
        continue;
      }
      rest.push(line);
    }
    flush();
  }
  // Still open at the end of this container: close it here, flagged.
  while (stack.length > 1) {
    const f = stack.pop()!;
    push(details(f, true));
  }
  return stack[0]!.blocks;
}

function isTagLine(line: string): boolean {
  const s = line.trim();
  return OPEN.test(s) || CLOSE.test(s);
}

function block(tok: Token): Block | null {
  switch (tok.type) {
    case "paragraph":
      return { t: "p", c: inlines((tok as Tokens.Paragraph).tokens) };
    case "text": {
      const t = tok as Tokens.Text;
      return { t: "span", c: t.tokens ? inlines(t.tokens) : [{ t: "text", v: t.text }] };
    }
    case "heading": {
      const h = tok as Tokens.Heading;
      return { t: "h", level: h.depth, c: inlines(h.tokens) };
    }
    case "hr":
      return { t: "hr" };
    case "blockquote":
      return { t: "quote", blocks: blocks((tok as Tokens.Blockquote).tokens) };
    case "list": {
      const l = tok as Tokens.List;
      const items: ListItem[] = l.items.map((it) => ({
        task: it.task ? !!it.checked : null,
        blocks: blocks(it.tokens.filter((x) => x.type !== "checkbox")),
      }));
      return { t: "list", ordered: l.ordered, start: typeof l.start === "number" ? l.start : 1, items };
    }
    case "table": {
      const tb = tok as Tokens.Table;
      return {
        t: "table",
        align: tb.align.map((a): Align => a ?? null),
        head: tb.header.map((c) => inlines(c.tokens)),
        rows: tb.rows.map((r) => r.map((c) => inlines(c.tokens))),
      };
    }
    case "code": {
      const c = tok as Tokens.Code;
      const lang = (c.lang ?? "").trim().split(/\s+/)[0] ?? "";
      if (lang === "diff" || lang === "patch") {
        const d = parseDiffFence(c.text);
        if (d) return { t: "diff", lang, text: c.text, hunks: d.hunks, numbered: d.numbered };
      }
      return { t: "code", lang, text: c.text };
    }
    default:
      return tok.raw ? { t: "literal", v: tok.raw.replace(/\n+$/, "") } : null;
  }
}

function inlineOf(text: string): Inline[] {
  const first = lexer.lexer(text)[0];
  return first && "tokens" in first && first.tokens ? inlines(first.tokens) : [{ t: "text", v: text }];
}

function inlines(tokens: readonly Token[]): Inline[] {
  const out: Inline[] = [];
  const text = (v: string) => {
    if (!v) return;
    const last = out[out.length - 1];
    if (last?.t === "text") last.v += v;
    else out.push({ t: "text", v });
  };
  for (const tok of tokens) {
    switch (tok.type) {
      case "text": {
        const t = tok as Tokens.Text;
        if (t.tokens?.length) out.push(...inlines(t.tokens));
        else text(t.text);
        break;
      }
      case "escape":
        text((tok as Tokens.Escape).text);
        break;
      case "codespan":
        out.push({ t: "code", v: (tok as Tokens.Codespan).text });
        break;
      case "strong":
      case "em":
      case "del":
        out.push({ t: tok.type, c: inlines((tok as Tokens.Strong).tokens) });
        break;
      case "br":
        out.push({ t: "br" });
        break;
      case "link": {
        const l = tok as Tokens.Link;
        const href = safeHref(l.href);
        if (href) out.push({ t: "link", href, c: inlines(l.tokens) });
        else for (const x of inlines(l.tokens)) x.t === "text" ? text(x.v) : out.push(x);
        break;
      }
      case "image": {
        const im = tok as Tokens.Image;
        text(im.text || im.raw);
        break;
      }
      case "html": {
        const raw = (tok as Tokens.Tag).text;
        if (BR.test(raw.trim())) out.push({ t: "br" });
        else text(raw);
        break;
      }
      default:
        text(tok.raw);
    }
  }
  return out;
}
