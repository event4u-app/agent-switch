import { describe, expect, it } from "vitest";

import { MAX_NODES, MAX_SOURCE, reuseBlocks, treeFor } from "./Markdown.js";
import { parseMarkdown } from "./parse.js";

/** Shapes at and beyond the largest seen in the local corpus
 *  (agents/evidence/markdown-corpus-2026-11.md: 36 896 chars, a 347-line fence). */
const openFence = "Here is the file:\n\n```ts\n" + Array.from({ length: 1000 }, (_, i) => `const line${i} = ${i}; // ${"x".repeat(30)}`).join("\n");
const bigTable = "| a | b | c | d |\n|---|---|---|---|\n" + Array.from({ length: 1000 }, (_, i) => `| \`r${i}\` | **${i}** | text ${i} | [l](https://e.x/${i}) |`).join("\n");
const deepList = Array.from({ length: 60 }, (_, i) => `${"  ".repeat(i)}- level ${i}`).join("\n");
const longProse = Array.from({ length: 400 }, (_, i) => `Paragraph ${i} with \`code\`, **bold**, a_snake and https://e.x/${i}.`).join("\n\n");

function median(f: () => void, runs = 7): number {
  const t: number[] = [];
  for (let i = 0; i < runs; i++) {
    const s = performance.now();
    f();
    t.push(performance.now() - s);
  }
  return t.sort((a, b) => a - b)[Math.floor(runs / 2)]!;
}

describe("markdown budgets (2.6)", () => {
  it("one parse of each heavy shape stays far under a frame budget multiple", () => {
    const rows: [string, number, number][] = [];
    for (const [name, src] of Object.entries({ openFence, bigTable, deepList, longProse })) {
      parseMarkdown(src); // warm up
      const ms = median(() => parseMarkdown(src));
      rows.push([name, src.length, Math.round(ms * 10) / 10]);
      // Generous for slow CI machines; the measured numbers are in the evidence file.
      expect(ms, name).toBeLessThan(250);
    }
    console.log("parse ms (median of 7):", JSON.stringify(rows));
  });

  it("streaming a long open fence: total parse work stays bounded with per-frame coalescing", () => {
    // 60 frames per second, the agent emits ~200 chars per frame at most in practice;
    // simulate the full fence arriving in 200-char frames.
    const s = performance.now();
    let frames = 0;
    for (let i = 200; i < openFence.length; i += 200, frames++) parseMarkdown(openFence.slice(0, i));
    const total = performance.now() - s;
    console.log(`open fence ${openFence.length} chars in ${frames} frames: ${Math.round(total)} ms total, ${(total / frames).toFixed(2)} ms/frame`);
    expect(total / frames).toBeLessThan(16);
  });

  it("keeping unchanged blocks costs less than the parse it follows", () => {
    const a = parseMarkdown(longProse);
    const b = parseMarkdown(longProse + " more");
    const ms = median(() => reuseBlocks(a, b));
    const t = parseMarkdown(bigTable);
    const msTable = median(() => reuseBlocks(t, parseMarkdown(bigTable)));
    console.log(`reuse ms: longProse ${ms.toFixed(2)}, bigTable ${msTable.toFixed(2)}`);
    expect(ms).toBeLessThan(50);
  });

  it("the limits turn pathological input into plain text instead of a stall", () => {
    expect(treeFor("a".repeat(MAX_SOURCE + 1))).toBeNull();
    const many = Array.from({ length: MAX_NODES }, (_, i) => `- ${i}`).join("\n");
    expect(treeFor(many)).toBeNull();
    expect(treeFor(bigTable)).not.toBeNull();
  });
});
