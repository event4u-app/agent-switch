import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { asChatMode, useBridge, type BridgeDeps } from "./useBridge.js";
import type * as ipc from "../../ipc.js";

afterEach(cleanup);

describe("the chat's permission mode", () => {
  it("asChatMode: the chat's modes, Claude's `manual` as `default`; never one that skips approvals", () => {
    expect(asChatMode("auto")).toBe("auto");
    expect(asChatMode("manual")).toBe("default");
    expect(asChatMode("bypassPermissions")).toBeNull();
    expect(asChatMode("inherit")).toBeNull();
  });

  it("an inherited mode shows as the bridge reports it (auto in the terminal is auto in the chat), and a change goes to the agent", async () => {
    let line: (l: string) => void = () => {};
    const sent: object[] = [];
    const deps: BridgeDeps = {
      history: async () => ({ events: [], from: 0, earlierPrompts: 0 }) as never,
      open: async (_s: ipc.BridgeSpec, onLine: (l: string) => void) => {
        line = onLine;
        return { send: async (c: object) => void sent.push(c), kill: async () => {} };
      },
    };
    let api: ReturnType<typeof useBridge> | null = null;
    function P() {
      api = useBridge({ key: "claude/w/0a1b2c3d", mode: "inherit" }, deps);
      return null;
    }
    render(<P />);
    await act(async () => void (await new Promise((r) => setTimeout(r, 0))));
    expect(api!.mode).toBe("default");
    await act(async () => line(JSON.stringify({ bridge: "ready", key: "claude/w/0a1b2c3d", mode: "auto" })));
    expect(api!.mode).toBe("auto");
    await act(async () => line(JSON.stringify({ bridge: "session", key: "claude/w/0a1b2c3d", model: "m", mode: "manual", commands: [] })));
    expect(api!.mode, "what the agent itself reports wins").toBe("default");
    await act(async () => api!.setMode("auto"));
    expect(api!.mode).toBe("auto");
    expect(sent).toContainEqual({ cmd: "set-mode", mode: "auto" });
  });
});
