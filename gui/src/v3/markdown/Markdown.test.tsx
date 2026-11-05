import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const shellOpen = vi.fn(async (_url: string) => {});
vi.mock("@tauri-apps/plugin-shell", () => ({ open: (u: string) => shellOpen(u) }));

import { FIXTURES } from "./fixtures.js";
import { Markdown, MAX_SOURCE, reuseBlocks, setMarkdownEnabled, treeFor } from "./Markdown.js";
import { parseMarkdown } from "./parse.js";

afterEach(() => {
  cleanup();
  shellOpen.mockClear();
  setMarkdownEnabled(true);
});

describe("Markdown — rendering (2.4)", () => {
  it("draws the table, code with its label and copy button, the diff view and a collapsed disclosure", () => {
    const { container } = render(<Markdown source={[FIXTURES.commitTable, FIXTURES.fences, FIXTURES.details].join("\n\n")} />);
    expect(container.querySelectorAll("table")).toHaveLength(1);
    expect(container.querySelectorAll("th")).toHaveLength(3);
    expect(container.querySelector("td br")).toBeTruthy();
    expect(screen.getByText("bash")).toBeTruthy();
    expect(screen.getAllByLabelText("Copy code").length).toBeGreaterThanOrEqual(3);
    expect(container.querySelector("pre code")!.textContent).toBe("npm ci\nnpm test -- src/v3");
    const details = container.querySelectorAll("details");
    expect(details).toHaveLength(2);
    expect(details[0]!.open).toBe(false);
    expect(details[0]!.querySelector("summary strong")!.textContent).toBe("42");
  });

  it("raw HTML shows as text: no script, div, or onclick element is created", () => {
    const { container } = render(<Markdown source={FIXTURES.rawHtml!} />);
    expect(container.querySelector("script, div[align], b")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
    expect(container.textContent).toContain('<b onclick="x()">tag</b>');
  });

  it("only http(s) links are anchors; a click goes to the native opener and never navigates", async () => {
    const { container } = render(<Markdown source={FIXTURES.links!} />);
    const anchors = [...container.querySelectorAll("a")];
    expect(anchors.map((a) => a.getAttribute("href"))).toEqual(["https://github.com/event4u-app/agent-switch/pull/152", "https://example.com/a_b"]);
    expect(container.querySelector("img")).toBeNull();
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    await act(async () => void anchors[1]!.dispatchEvent(ev));
    expect(ev.defaultPrevented).toBe(true);
    expect(shellOpen).toHaveBeenCalledWith("https://example.com/a_b");
  });

  it("task items are disabled checkboxes", () => {
    const { container } = render(<Markdown source={FIXTURES.nestedLists!} />);
    const boxes = [...container.querySelectorAll<HTMLInputElement>("input[type=checkbox]")];
    expect(boxes.map((b) => [b.checked, b.disabled])).toEqual([
      [false, true],
      [true, true],
    ]);
  });

  it("falls back to plain text when switched off or over the size budget", () => {
    setMarkdownEnabled(false);
    const off = render(<Markdown source={"| a |\n|---|\n| b |"} />);
    expect(off.container.querySelector("table")).toBeNull();
    expect(off.container.textContent).toBe("| a |\n|---|\n| b |");
    off.unmount();
    setMarkdownEnabled(true);
    expect(treeFor("x".repeat(MAX_SOURCE + 1))).toBeNull();
  });
});

describe("Markdown — streaming (2.5)", () => {
  it("every prefix of every fixture parses, and the code text of the whole is byte-exact", () => {
    for (const [name, src] of Object.entries(FIXTURES)) {
      for (let i = 0; i <= src.length; i++) expect(() => parseMarkdown(src.slice(0, i)), `${name}@${i}`).not.toThrow();
    }
  });

  it("built up chunk by chunk with block reuse, the final tree equals the one-shot parse", () => {
    const rnd = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed / 0x7fffffff);
    for (const [name, src] of Object.entries(FIXTURES)) {
      for (const seed of [1, 2, 3]) {
        const r = rnd(seed);
        let prev = parseMarkdown("");
        for (let i = 0; i < src.length; ) {
          i = Math.min(src.length, i + 1 + Math.floor(r() * 12));
          prev = reuseBlocks(prev, parseMarkdown(src.slice(0, i)));
        }
        expect(prev, `${name} seed ${seed}`).toEqual(parseMarkdown(src));
      }
    }
  });

  it("an unchanged block keeps its object, so React skips it", () => {
    const a = parseMarkdown("# Title\n\nfirst para\n\nsecond");
    const b = reuseBlocks(a, parseMarkdown("# Title\n\nfirst para\n\nsecond grows"));
    expect(b[0]).toBe(a[0]);
    expect(b[1]).toBe(a[1]);
    expect(b[2]).not.toBe(a[2]);
  });

  it("an open fence shows as code while live; links in the live last block stay inert until the turn ends", async () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "setTimeout", "clearTimeout"] });
    try {
      const { container, rerender } = render(<Markdown live source={"Look https://example.com/x\n\n```ts\nconst a"} />);
      expect(container.querySelector("pre code")?.textContent).toBe("const a");
      // Not the last block: already settled, so its link is live.
      expect(container.querySelector("a")?.getAttribute("href")).toBe("https://example.com/x");
      rerender(<Markdown live source={"See https://example.com/x"} />);
      await act(async () => void vi.advanceTimersByTime(50));
      expect(container.textContent).toBe("See https://example.com/x");
      expect(container.querySelector("a")).toBeNull();
      rerender(<Markdown live={false} source={"See https://example.com/x"} />);
      expect(container.querySelector("a")?.getAttribute("href")).toBe("https://example.com/x");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a disclosure the user opened stays open while text streams into it", () => {
    const { container, rerender } = render(<Markdown live={false} source={"<details>\n<summary>Log</summary>\n\n- a\n"} />);
    const d = container.querySelector("details")!;
    fireEvent.click(d.querySelector("summary")!);
    d.open = true;
    rerender(<Markdown live={false} source={"<details>\n<summary>Log</summary>\n\n- a\n- b\n"} />);
    expect(container.querySelector("details")).toBe(d);
    expect(d.open).toBe(true);
    expect(d.querySelectorAll("li")).toHaveLength(2);
  });

  it("while live, rapid updates are coalesced and the newest text wins", async () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "setTimeout", "clearTimeout"] });
    try {
      const { container, rerender } = render(<Markdown live source="a" />);
      for (const s of ["ab", "abc", "abcd"]) rerender(<Markdown live source={s} />);
      expect(container.textContent).toBe("a");
      await act(async () => void vi.advanceTimersByTime(50));
      expect(container.textContent).toBe("abcd");
    } finally {
      vi.useRealTimers();
    }
  });
});
