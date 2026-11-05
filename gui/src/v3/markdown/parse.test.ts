import { describe, expect, it } from "vitest";

import { parseDiffFence } from "./diff.js";
import { FIXTURES } from "./fixtures.js";
import { activateLink, safeHref } from "./links.js";
import type { Block, Inline } from "./nodes.js";
import { parseMarkdown } from "./parse.js";

/** All inline nodes of a tree, depth first. */
function allInlines(bs: Block[]): Inline[] {
  const out: Inline[] = [];
  const walkI = (xs: Inline[]) => {
    for (const x of xs) {
      out.push(x);
      if ("c" in x) walkI(x.c);
    }
  };
  const walkB = (xs: Block[]) => {
    for (const b of xs) {
      if ("c" in b) walkI(b.c);
      if (b.t === "quote") walkB(b.blocks);
      if (b.t === "list") b.items.forEach((i) => walkB(i.blocks));
      if (b.t === "details") {
        if (b.summary) walkI(b.summary);
        walkB(b.blocks);
      }
      if (b.t === "table") [b.head, ...b.rows].forEach((r) => r.forEach(walkI));
    }
  };
  walkB(bs);
  return out;
}
const textOf = (bs: Block[]) => allInlines(bs).map((x) => (x.t === "text" || x.t === "code" ? x.v : "")).join("");

describe("parseMarkdown — dialect (agents/evidence/markdown-corpus-2026-11.md)", () => {
  it("every fixture parses, and no node carries a parser token", () => {
    for (const [name, src] of Object.entries(FIXTURES)) {
      const tree = parseMarkdown(src);
      expect(tree.length, name).toBeGreaterThan(0);
      expect(JSON.stringify(tree), name).not.toMatch(/"(type|raw|tokens)":/);
    }
  });

  it("a table keeps its cells; <br> becomes a break; an escaped pipe stays in the cell, a bare one splits it (GFM)", () => {
    const [, table] = parseMarkdown(FIXTURES.commitTable!);
    expect(table?.t).toBe("table");
    if (table?.t !== "table") return;
    expect(table.head).toHaveLength(3);
    expect(table.rows).toHaveLength(3);
    expect(table.rows[1]![1]!.some((x) => x.t === "br")).toBe(true);
    const last = table.rows[2]![2]!;
    expect(last.filter((x) => x.t === "code").map((x) => (x as { v: string }).v)).toEqual(["a|b"]);
    // GFM: a pipe inside a code span still splits the row unless escaped; the extra cell is dropped.
    expect(table.rows[2]).toHaveLength(3);
  });

  it("lists nest, ordered lists keep their start, task items carry their state", () => {
    const tree = parseMarkdown(FIXTURES.nestedLists!);
    const lists = tree.filter((b) => b.t === "list");
    expect(lists).toHaveLength(2);
    const [ordered, tasks] = lists as Extract<Block, { t: "list" }>[];
    expect(ordered!.ordered).toBe(true);
    const inner = ordered!.items[0]!.blocks.find((b) => b.t === "list") as Extract<Block, { t: "list" }>;
    expect(inner.items).toHaveLength(2);
    expect(inner.items[1]!.blocks.some((b) => b.t === "list")).toBe(true);
    expect(tasks!.items.map((i) => i.task)).toEqual([false, true]);
  });

  it("fences: language label, exact text, tilde and in-list fences, numbered diff from @@", () => {
    const tree = parseMarkdown(FIXTURES.fences!);
    const code = tree.filter((b) => b.t === "code") as Extract<Block, { t: "code" }>[];
    expect(code.map((c) => c.lang)).toEqual(["bash", "ts"]);
    expect(code[0]!.text).toBe("npm ci\nnpm test -- src/v3");
    const list = tree.find((b) => b.t === "list") as Extract<Block, { t: "list" }>;
    expect(list.items[0]!.blocks.some((b) => b.t === "code" && b.lang === "json")).toBe(true);
    const diff = tree.find((b) => b.t === "diff") as Extract<Block, { t: "diff" }>;
    expect(diff.numbered).toBe(true);
    expect(diff.hunks[0]!.oldStart).toBe(10);
    expect(diff.hunks[0]!.lines.filter((l) => l[0] === "+")).toHaveLength(2);
  });

  it("an unclosed fence is code to the end of the text", () => {
    const [b] = parseMarkdown("```ts\nconst a = 1;\nconst b");
    expect(b).toEqual({ t: "code", lang: "ts", text: "const a = 1;\nconst b" });
  });

  it("details nest, take their summary, and tags inside code stay code", () => {
    const tree = parseMarkdown(FIXTURES.details!);
    const d = tree.find((b) => b.t === "details") as Extract<Block, { t: "details" }>;
    expect(d.unclosed).toBe(false);
    expect(allInlines([{ t: "p", c: d.summary! }]).some((x) => x.t === "strong")).toBe(true);
    expect(d.blocks[0]!.t).toBe("list");
    const inner = d.blocks.find((b) => b.t === "details") as Extract<Block, { t: "details" }>;
    expect(inner.blocks).toEqual([{ t: "code", lang: "", text: "inner code <details> stays code" }]);
    expect(tree[tree.length - 1]).toEqual({ t: "p", c: [{ t: "text", v: "After." }] });
  });

  it("details: missing closer is flagged, a stray closer and other tags stay literal, text after a summary is markdown", () => {
    const open = parseMarkdown("<details>\n<summary>S</summary>\n\n- a");
    expect(open).toMatchObject([{ t: "details", unclosed: true, blocks: [{ t: "list" }] }]);
    expect(parseMarkdown("</details>")).toEqual([{ t: "literal", v: "</details>" }]);
    const after = parseMarkdown("<details>\n<summary>S</summary>\ntext right after\n\n</details>");
    expect(after).toMatchObject([{ t: "details", unclosed: false, blocks: [{ t: "p" }] }]);
    expect(parseMarkdown("<details open>\nx\n</details>")[0]!.t).toBe("literal");
  });

  it("links: only absolute http(s) becomes a link; the rest stays readable text", () => {
    const xs = allInlines(parseMarkdown(FIXTURES.links!));
    const links = xs.filter((x) => x.t === "link") as Extract<Inline, { t: "link" }>[];
    expect(links.map((l) => l.href)).toEqual(["https://github.com/event4u-app/agent-switch/pull/152", "https://example.com/a_b"]);
    const text = textOf(parseMarkdown(FIXTURES.links!));
    expect(text).toContain("js");
    expect(text).toContain("<slug> and <owner>/<repo>");
    expect(text).toContain("diagram");
    expect(text).not.toContain("javascript:");
  });

  it("underscore emphasis does not fire inside words (star does, per CommonMark); paths in code stay as typed", () => {
    const xs = allInlines(parseMarkdown(FIXTURES.emphasis!));
    expect(xs.filter((x) => x.t === "em").map((x) => textOf([{ t: "p", c: (x as { c: Inline[] }).c }]))).toEqual(["3", "italic"]);
    expect(xs.filter((x) => x.t === "strong")).toHaveLength(1);
    expect(xs.filter((x) => x.t === "del")).toHaveLength(1);
    expect(textOf(parseMarkdown(FIXTURES.emphasis!))).toContain("snake_case_name and 2");
    expect(xs.find((x) => x.t === "code")).toEqual({ t: "code", v: "src/*.ts" });
  });

  it("raw HTML is never markup: block and inline tags come back as literal text", () => {
    const tree = parseMarkdown(FIXTURES.rawHtml!);
    expect(tree.slice(0, 2)).toEqual([
      { t: "literal", v: '<div align="center">raw</div>' },
      { t: "literal", v: "<script>alert(1)</script>" },
    ]);
    expect(textOf(tree)).toContain('<b onclick="x()">tag</b>');
  });

  it("unmatched emphasis and a half link stay literal while streaming", () => {
    expect(parseMarkdown("**open bold and `open code")).toEqual([{ t: "p", c: [{ t: "text", v: "**open bold and `open code" }] }]);
    // The half link is not a link; its bare URL is a GFM autolink, which the renderer
    // keeps inert while the message is live (Markdown.test.tsx).
    const half = allInlines(parseMarkdown("see [the docs](https://exa"));
    expect(half.filter((x) => x.t === "link").map((x) => (x as { href: string }).href)).toEqual(["https://exa/"]);
    expect(textOf(parseMarkdown("see [the docs](https://exa"))).toContain("[the docs](");
  });
});

describe("safeHref", () => {
  it.each([
    ["https://a.b/c?d=e#f", "https://a.b/c?d=e#f"],
    ["http://localhost:3000/x", "http://localhost:3000/x"],
    ["javascript:alert(1)", null],
    ["JAVASCRIPT:alert(1)", null],
    ["data:text/html,<script>", null],
    ["file:///etc/passwd", null],
    ["vbscript:x", null],
    ["agent-switch://open", null],
    ["//evil.com/x", null],
    ["./README.md", null],
    ["#top", null],
    ["mailto:a@b.c", null],
    ["https://a.b/\u0000x", null],
    ["java\tscript:alert(1)", null],
    [" https://a.b", null],
    ["", null],
  ])("%j → %j", (href, want) => expect(safeHref(href)).toBe(want));
});

describe("activateLink", () => {
  it("opens through the native opener; on a refusal copies; never for a refused destination", async () => {
    const calls: string[] = [];
    const open = async (u: string) => void calls.push(`open ${u}`);
    const deny = async () => {
      throw new Error("not in scope");
    };
    const copy = async (t: string) => void calls.push(`copy ${t}`);
    expect(await activateLink("https://a.b/x", { open, copy })).toBe("opened");
    expect(await activateLink("https://c.d/y", { open: deny, copy })).toBe("copied");
    expect(await activateLink("javascript:alert(1)", { open, copy })).toBe("refused");
    expect(calls).toEqual(["open https://a.b/x", "copy https://c.d/y"]);
  });
});

describe("parseDiffFence", () => {
  it("no @@ header: unnumbered; git headers are skipped; no change lines: not a diff", () => {
    expect(parseDiffFence("-a\n+b")).toEqual({ hunks: [{ oldStart: 1, newStart: 1, lines: ["-a", "+b"] }], numbered: false });
    const git = parseDiffFence("diff --git a/x b/x\nindex 1..2 100644\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-x\n+y");
    expect(git).toEqual({ hunks: [{ oldStart: 1, newStart: 1, lines: ["-x", "+y"] }], numbered: true });
    expect(parseDiffFence("just text\nmore")).toBeNull();
  });
});
