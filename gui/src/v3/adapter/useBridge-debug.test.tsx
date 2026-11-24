import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

const { recordDebug } = vi.hoisted(() => ({ recordDebug: vi.fn() }));
vi.mock("../../debug-log.js", async (orig) => ({ ...(await orig<typeof import("../../debug-log.js")>()), recordDebug }));

import { useBridge, type BridgeDeps } from "./useBridge.js";
import type * as ipc from "../../ipc.js";

afterEach(() => {
  cleanup();
  recordDebug.mockReset();
});

function Probe({ deps }: { deps: BridgeDeps }) {
  useBridge({ key: "claude/w/0a1b2c3d", mode: "default" }, deps);
  return null;
}
const flush = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

describe("useBridge in the debug log", () => {
  it("a chat process that ends with an error is written with its code and the last line of stderr; a clean close is not", async () => {
    let close: (c: number | null, stderr?: string) => void = () => {};
    const deps: BridgeDeps = {
      history: async () => ({ events: [], from: 0, earlierPrompts: 0 }) as never,
      open: async (_s: ipc.BridgeSpec, _l: (l: string) => void, onClose: (c: number | null, stderr?: string) => void) => {
        close = onClose;
        return { send: async () => {}, kill: async () => {} };
      },
    };
    render(<Probe deps={deps} />);
    await flush();
    close(0, "");
    expect(recordDebug).not.toHaveBeenCalled();
    close(1, "warning: x\nerror: --mode is one of default, acceptEdits, plan\n");
    expect(recordDebug).toHaveBeenCalledWith(expect.objectContaining({ kind: "bridge", what: "chat process ended", key: "claude/w/0a1b2c3d", ok: false, error: "error: --mode is one of default, acceptEdits, plan", detail: { code: 1 } }));
  });

  it("a command that never reached the chat is written by its name, never with what it carried", async () => {
    const deps: BridgeDeps = {
      history: async () => ({ events: [], from: 0, earlierPrompts: 0 }) as never,
      open: async () => ({ send: async () => Promise.reject(new Error("broken pipe")), kill: async () => {} }),
    };
    let api: ReturnType<typeof useBridge> | null = null;
    function P() {
      api = useBridge({ key: "claude/w/0a1b2c3d", mode: "default" }, deps);
      return null;
    }
    render(<P />);
    await flush();
    api!.send("my secret prompt");
    await flush();
    const e = recordDebug.mock.calls.find((c) => c[0].what === "send did not reach the chat")?.[0];
    expect(e).toMatchObject({ kind: "bridge", ok: false, error: "broken pipe" });
    expect(JSON.stringify(recordDebug.mock.calls)).not.toContain("secret");
  });
});
