import { describe, it, expect, vi } from "vitest";
import { attachTerminal, type TermBackend, type TerminalLike, type TermEvent } from "./terminal.js";

/** A fake terminal capturing writes + the onData callback. */
function fakeTerm() {
  const writes: string[] = [];
  let dataCb: (d: string) => void = () => {};
  const term: TerminalLike = {
    rows: 24,
    cols: 80,
    write: (d) => writes.push(d),
    onData: (cb) => (dataCb = cb),
  };
  return { term, writes, type: (d: string) => dataCb(d) };
}

/** A fake backend that captures the event sink so tests can push pty output. */
function fakeBackend(id = 7) {
  let sink: (e: TermEvent) => void = () => {};
  const calls = { open: [] as any[], write: [] as any[], resize: [] as any[], close: [] as any[] };
  const backend: TermBackend = {
    open: vi.fn(async (args, rows, cols, onEvent) => {
      calls.open.push({ args, rows, cols });
      sink = onEvent;
      return id;
    }),
    write: vi.fn(async (i, d) => void calls.write.push({ i, d })),
    resize: vi.fn(async (i, r, c) => void calls.resize.push({ i, r, c })),
    close: vi.fn(async (i) => void calls.close.push({ i })),
  };
  return { backend, calls, emit: (e: TermEvent) => sink(e) };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("attachTerminal", () => {
  it("opens the pty with the args + terminal size", async () => {
    const { term } = fakeTerm();
    const { backend, calls } = fakeBackend();
    attachTerminal(term, backend, ["add", "work", "--provider", "codex"], () => {});
    await flush();
    expect(calls.open[0]).toEqual({ args: ["add", "work", "--provider", "codex"], rows: 24, cols: 80 });
  });

  it("writes pty output into the terminal", async () => {
    const { term, writes } = fakeTerm();
    const { backend, emit } = fakeBackend();
    attachTerminal(term, backend, ["run", "work"], () => {});
    await flush();
    emit({ kind: "data", data: "hello\r\n" });
    expect(writes).toEqual(["hello\r\n"]);
  });

  it("forwards keystrokes to the pty once opened", async () => {
    const { term, type } = fakeTerm();
    const { backend, calls } = fakeBackend(42);
    attachTerminal(term, backend, ["run", "work"], () => {});
    await flush(); // let open() resolve so the id is known
    type("l");
    type("s");
    expect(calls.write).toEqual([{ i: 42, d: "l" }, { i: 42, d: "s" }]);
  });

  it("does not forward keystrokes before the pty is open (no id yet)", () => {
    const { term, type } = fakeTerm();
    const { backend, calls } = fakeBackend();
    attachTerminal(term, backend, ["run", "work"], () => {});
    type("x"); // open() not resolved yet
    expect(calls.write).toEqual([]);
  });

  it("calls onExit when the process ends", async () => {
    const { term } = fakeTerm();
    const { backend, emit } = fakeBackend();
    const onExit = vi.fn();
    attachTerminal(term, backend, ["add", "work"], onExit);
    await flush();
    emit({ kind: "exit", code: 0 });
    expect(onExit).toHaveBeenCalledWith(0);
  });

  it("resize + dispose drive the backend; dispose closes exactly the open session", async () => {
    const { term } = fakeTerm();
    const { backend, calls } = fakeBackend(9);
    const ctrl = attachTerminal(term, backend, ["run", "work"], () => {});
    await flush();
    ctrl.resize(30, 100);
    expect(calls.resize).toEqual([{ i: 9, r: 30, c: 100 }]);
    await ctrl.dispose();
    expect(calls.close).toEqual([{ i: 9 }]);
  });

  it("suppresses onExit fired during teardown", async () => {
    const { term } = fakeTerm();
    const { backend, emit } = fakeBackend();
    const onExit = vi.fn();
    const ctrl = attachTerminal(term, backend, ["run", "work"], onExit);
    await flush();
    await ctrl.dispose();
    emit({ kind: "exit", code: null }); // exit racing with teardown
    expect(onExit).not.toHaveBeenCalled();
  });
});
