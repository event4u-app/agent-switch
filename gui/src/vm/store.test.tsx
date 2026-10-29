import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { emptyViewModel } from "./load.js";
import { ASProvider, TERMINAL_BUSY_TOAST, useAS, type Store } from "./store.js";
import type { ViewModel } from "./types.js";

function harness(props: { load?: () => Promise<ViewModel> } = {}) {
  const ref: { current: Store | null } = { current: null };
  function Grab() {
    ref.current = useAS();
    return null;
  }
  render(
    <ASProvider initial={emptyViewModel(1)} load={props.load}>
      <Grab />
    </ASProvider>,
  );
  return () => ref.current!;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("store — the single overlay slot and a running terminal", () => {
  afterEach(cleanup);

  const terminal = { kind: "terminal" as const, run: { args: ["run", "work"], title: "work" } };

  it("does not replace a terminal overlay whose command is still running", () => {
    const s = harness();
    act(() => s().open(terminal));
    act(() => s().setTerminalBusy(true));
    act(() => s().open({ kind: "start" }));
    expect(s().overlay.kind).toBe("terminal");
    act(() => s().go("settings", "general"));
    expect(s().overlay.kind).toBe("terminal");
    expect(s().screen).toBe("home");
    expect(s().toasts.map((t) => t.text)).toContain(TERMINAL_BUSY_TOAST);
  });

  it("lets other overlays in once the command finished, and the terminal's own close always works", () => {
    const s = harness();
    act(() => s().open(terminal));
    act(() => s().setTerminalBusy(true));
    act(() => s().setTerminalBusy(false));
    act(() => s().open({ kind: "notifications" }));
    expect(s().overlay.kind).toBe("notifications");

    act(() => s().open(terminal));
    act(() => s().setTerminalBusy(true));
    act(() => s().close());
    expect(s().overlay.kind).toBe("none");
    act(() => s().open({ kind: "start" }));
    expect(s().overlay.kind).toBe("start");
  });

  it("a busy flag without a terminal overlay blocks nothing", () => {
    const s = harness();
    act(() => s().setTerminalBusy(true));
    act(() => s().open({ kind: "start" }));
    expect(s().overlay.kind).toBe("start");
  });
});

describe("store — reload ordering", () => {
  afterEach(cleanup);

  it("only the latest reload's result applies, and loading follows the latest", async () => {
    const calls: ReturnType<typeof deferred<ViewModel>>[] = [];
    const load = () => {
      const d = deferred<ViewModel>();
      calls.push(d);
      return d.promise;
    };
    const s = harness({ load });
    // Mount fired reload #1; start #2 after it.
    let second!: Promise<void>;
    act(() => {
      second = s().reload();
    });
    expect(calls).toHaveLength(2);
    expect(s().loading).toBe(true);

    // The newer one lands first …
    await act(async () => {
      calls[1].resolve({ ...emptyViewModel(2), error: "newer" });
      await second;
    });
    expect(s().error).toBe("newer");
    expect(s().loading).toBe(false);

    // … and the older one, landing later, must not overwrite it.
    await act(async () => {
      calls[0].resolve({ ...emptyViewModel(3), error: "older" });
      await flush();
    });
    expect(s().error).toBe("newer");
    expect(s().loading).toBe(false);
  });

  it("an older reload finishing first does not clear loading for the newer one", async () => {
    const calls: ReturnType<typeof deferred<ViewModel>>[] = [];
    const load = () => {
      const d = deferred<ViewModel>();
      calls.push(d);
      return d.promise;
    };
    const s = harness({ load });
    act(() => {
      void s().reload();
    });
    await act(async () => {
      calls[0].resolve({ ...emptyViewModel(2), error: "older" });
      await flush();
    });
    expect(s().loading).toBe(true);
    expect(s().error).toBeNull();
    await act(async () => {
      calls[1].resolve({ ...emptyViewModel(3), error: "newer" });
      await flush();
    });
    expect(s().loading).toBe(false);
    expect(s().error).toBe("newer");
  });
});
