import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    rows = 24;
    cols = 80;
    loadAddon() {}
    open() {}
    focus() {}
    write() {}
    onData() {}
    dispose() {}
  },
}));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() {} } }));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

import type { TermBackend, TermEvent } from "../../terminal.js";
import { AcRoot } from "../../ui/AcRoot.js";
import { emptyViewModel } from "../../vm/load.js";
import { ASProvider, TERMINAL_BUSY_TOAST, useAS, type Store } from "../../vm/store.js";
import { TerminalSheet } from "./terminal-sheet.js";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    disconnect() {}
    unobserve() {}
  } as unknown as typeof ResizeObserver;
});

const flush = () => new Promise((r) => setTimeout(r, 0));

function backendWith(open: TermBackend["open"]): TermBackend {
  return { open, write: vi.fn(async () => {}), resize: vi.fn(async () => {}), close: vi.fn(async () => {}) };
}

function mount(backend: TermBackend) {
  const ref: { current: Store | null } = { current: null };
  function Host() {
    const s = useAS();
    ref.current = s;
    return s.overlay.kind === "terminal" && "run" in s.overlay ? <TerminalSheet run={s.overlay.run} backend={backend} /> : null;
  }
  render(
    <AcRoot>
      <ASProvider initial={emptyViewModel(1)} startOverlay={{ kind: "terminal", run: { args: ["run", "work"], title: "work" } }}>
        <Host />
      </ASProvider>
    </AcRoot>,
  );
  return () => ref.current!;
}

describe("TerminalSheet", () => {
  afterEach(cleanup);

  it("while the command runs, Escape and a click outside keep it open and other overlays are refused", async () => {
    let sink: (e: TermEvent) => void = () => {};
    const s = mount(
      backendWith(async (_a, _r, _c, onEvent) => {
        sink = onEvent;
        return 1;
      }),
    );
    await act(flush);
    expect(screen.getByRole("status").textContent).toContain("Running");

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    fireEvent.pointerDown(document.body);
    expect(s().overlay.kind).toBe("terminal");

    act(() => s().open({ kind: "start" }));
    expect(s().overlay.kind).toBe("terminal");
    expect(s().toasts.map((t) => t.text)).toContain(TERMINAL_BUSY_TOAST);

    // Finished: normal dismissal again.
    act(() => sink({ kind: "exit", code: 0 }));
    expect(screen.getByRole("status").textContent).toContain("Finished · exit 0");
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(s().overlay.kind).toBe("none");
  });

  it("the Close button ends a running command", async () => {
    const backend = backendWith(async () => 5);
    const s = mount(backend);
    await act(flush);
    fireEvent.click(screen.getByTitle("Closing ends the command"));
    expect(s().overlay.kind).toBe("none");
    await act(flush);
    expect(backend.close).toHaveBeenCalledWith(5);
  });

  it("a pty that cannot start shows why instead of staying on Running", async () => {
    const s = mount(
      backendWith(async () => {
        throw new Error("no pty");
      }),
    );
    await act(flush);
    expect(screen.getByRole("status").textContent).toContain("Couldn't start · no pty");
    act(() => s().open({ kind: "start" }));
    expect(s().overlay.kind).toBe("start");
  });

  it("the xterm wrapper is not a live region", async () => {
    mount(backendWith(async () => 1));
    await act(flush);
    expect(document.querySelector("[data-terminal]")!.parentElement!.hasAttribute("aria-live")).toBe(false);
  });
});
