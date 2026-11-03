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
    history: vi.fn(async () => [{ t: "turn", id: "h", at: null }, { t: "message", id: "h", role: "user", text: "earlier", images: 0 }] as never),
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
