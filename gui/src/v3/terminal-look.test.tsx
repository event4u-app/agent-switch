import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

const loaded: string[] = [];
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    rows = 24;
    cols = 80;
    loadAddon(a: { name?: string }) {
      loaded.push(a.name ?? "fit");
    }
    open() {}
    focus() {}
    write() {}
    onData() {}
    dispose() {}
  },
}));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() {} } }));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));
const webgl = vi.hoisted(() => ({ fail: false }));
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    name = "webgl";
    constructor() {
      if (webgl.fail) throw new Error("no WebGL");
    }
    onContextLoss() {}
    dispose() {}
  },
}));

import type { TermBackend } from "../terminal.js";
import { HostedTerminal } from "./workbench.js";
import { XtermBox } from "../redesign/screens/terminal-sheet.js";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    disconnect() {}
    unobserve() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(() => (cleanup(), (loaded.length = 0), (webgl.fail = false)));

const backend: TermBackend = { open: vi.fn(async () => undefined as never), write: vi.fn(async () => {}), resize: vi.fn(async () => {}), close: vi.fn(async () => {}) };
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("the v3 terminal look (spec §6.4)", () => {
  it("pads a wrapper on the terminal background, never the measured host", () => {
    const { container } = render(<HostedTerminal sessionKey="claude/work/a" vars={{ "--as-term-bg": "#1e1f22", "--as-term-fg": "#bcbec4" }} followTheme backend={backend} onExit={() => {}} />);
    const host = container.querySelector("[data-terminal]")!;
    const frame = host.parentElement!;
    expect(frame.className).toMatch(/\bpx-5\b/);
    expect(frame.className).toMatch(/\bpy-4\b/);
    expect(frame.style.background).toBe("rgb(30, 31, 34)");
    expect(host.className).not.toMatch(/\bp[xy]?-\d/);
  });

  it("loads the WebGL renderer for the rounded box arcs", async () => {
    render(<HostedTerminal sessionKey="claude/work/a" vars={{ "--as-term-bg": "#000", "--as-term-fg": "#fff" }} followTheme backend={backend} onExit={() => {}} />);
    await flush();
    await flush();
    expect(loaded).toContain("webgl");
  });

  it("keeps the DOM renderer when WebGL is missing", async () => {
    webgl.fail = true;
    const { container } = render(<HostedTerminal sessionKey="claude/work/a" vars={{ "--as-term-bg": "#000", "--as-term-fg": "#fff" }} followTheme backend={backend} onExit={() => {}} />);
    await flush();
    await flush();
    expect(loaded).not.toContain("webgl");
    expect(container.querySelector("[data-terminal]")).not.toBeNull();
  });

  it("leaves the 2.11 sheet's terminal as it was", async () => {
    const { container } = render(<XtermBox args={["x"]} backend={backend} onExit={() => {}} />);
    await flush();
    expect(container.querySelector("[data-terminal-frame]")).toBeNull();
    expect(loaded).not.toContain("webgl");
  });
});
