import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { bridgeLine, useBridge, type BridgeDeps } from "./useBridge.js";
import type * as ipc from "../../ipc.js";

afterEach(cleanup);

function fake() {
  let line: (l: string) => void = () => {};
  let close: (c: number | null) => void = () => {};
  const sent: object[] = [];
  const deps: BridgeDeps = {
    history: vi.fn(async () => ({ events: [{ t: "turn", id: "h", at: null }, { t: "message", id: "h", role: "user", text: "earlier", images: 0 }] as never, from: 0, earlierPrompts: 0 })),
    open: vi.fn(async (_spec: ipc.BridgeSpec, onLine: (l: string) => void, onClose: (c: number | null) => void) => {
      line = onLine;
      close = onClose;
      return { send: async (c: object) => void sent.push(c), kill: async () => {} };
    }),
  };
  return { deps, sent, emit: (o: object) => line(JSON.stringify(o)), end: (c: number | null) => close(c) };
}

let api: ReturnType<typeof useBridge> | null = null;
function Probe({ spec, deps }: { spec: ipc.BridgeSpec | null; deps: BridgeDeps }) {
  api = useBridge(spec, deps);
  return <p>{`${api.status} · ${api.events.length} · q${api.queued} · ${api.session?.key ?? "-"} · ${api.error ?? ""}`}</p>;
}
const flush = () => act(async () => {
  await new Promise((r) => setTimeout(r, 0));
});

describe("useBridge", () => {
  it("a chat closed while its bridge was starting closes that bridge once it is up, so it never holds the session", async () => {
    const f = fake();
    let started: () => void = () => {};
    const gate = new Promise<void>((r) => (started = r));
    const open = f.deps.open;
    const deps: BridgeDeps = { ...f.deps, open: async (...a) => (await gate, open(...a)) };
    const { unmount } = render(<Probe spec={{ key: "claude/w/s1", mode: "default" }} deps={deps} />);
    await flush();
    unmount();
    started();
    await flush();
    expect(f.sent).toEqual([{ cmd: "close" }]);
  });

  it("a turn left open in the history is not a running turn; only the bridge's own turn and turn.end move it", async () => {
    const f = fake();
    render(<Probe spec={{ key: "claude/w/s1", mode: "default" }} deps={f.deps} />);
    await flush();
    f.emit({ bridge: "ready", key: "claude/w/s1", mode: "default" });
    await flush();
    expect(api!.turnOpen).toBe(false);
    f.emit({ event: { t: "turn", id: "l1", at: null } });
    await flush();
    expect(api!.turnOpen).toBe(true);
    f.emit({ event: { t: "turn.end", ok: true, durationMs: 1, costUsd: null } });
    await flush();
    expect(api!.turnOpen).toBe(false);
    f.emit({ event: { t: "turn", id: "l2", at: null } });
    f.emit({ bridge: "exit", code: 1 });
    await flush();
    expect(api!.turnOpen).toBe(false);
  });

  it("history first, then live events; session, queue, exit; commands go out as JSON", async () => {
    const f = fake();
    render(<Probe spec={{ key: "claude/w/s1", mode: "default" }} deps={f.deps} />);
    await flush();
    expect(f.deps.history).toHaveBeenCalledWith("claude/w/s1");
    f.emit({ bridge: "ready", key: "claude/w/s1", mode: "default" });
    f.emit({ bridge: "session", key: "claude/w/s1", model: "m", mode: "default", commands: ["compact"] });
    f.emit({ event: { t: "message.delta", id: "m:0", text: "hi" } });
    f.emit({ bridge: "queued", count: 2 });
    await flush();
    expect(screen.getByText(/^ready · 3 · q2 · claude\/w\/s1 ·$/)).toBeTruthy();
    api!.send("go", [{ path: "a.ts" }]);
    api!.approve("r1", true);
    api!.answer("q1", { "Colour?": "Blue" });
    api!.setMode("plan");
    api!.interrupt();
    await flush();
    expect(f.sent).toEqual([
      { cmd: "send", text: "go", attachments: [{ path: "a.ts" }] },
      { cmd: "approve", id: "r1", always: true },
      { cmd: "answer", id: "q1", answers: { "Colour?": "Blue" } },
      { cmd: "set-mode", mode: "plan" },
      { cmd: "interrupt" },
    ]);
    expect(api!.mode).toBe("plan");
    f.emit({ bridge: "exit", code: 0 });
    await flush();
    expect(screen.getByText(/^closed/)).toBeTruthy();
  });

  it("a start error is shown; a new chat reads no history; unmounting closes the bridge", async () => {
    const f = fake();
    const { unmount } = render(<Probe spec={{ new: { profile: "w", provider: "claude", cwd: "/r" }, mode: "default" }} deps={f.deps} />);
    await flush();
    expect(f.deps.history).not.toHaveBeenCalled();
    f.emit({ bridge: "error", message: "spawn claude ENOENT" });
    await flush();
    expect(screen.getByText("error · 0 · q0 · - · spawn claude ENOENT")).toBeTruthy();
    unmount();
    await flush();
    expect(f.sent.at(-1)).toEqual({ cmd: "close" });
  });

  it("bridgeLine ignores what is not the bridge's JSON", () => {
    expect(bridgeLine("not json")).toEqual({});
    expect(bridgeLine(JSON.stringify({ other: 1 }))).toEqual({});
    expect(bridgeLine(JSON.stringify({ bridge: "session", key: "k", commands: ["a", 1] })).bridge?.commands).toEqual(["a"]);
  });
});
