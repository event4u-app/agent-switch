import { beforeEach, describe, expect, it, vi } from "vitest";

const { create, execute, recordDebug, recentAction } = vi.hoisted(() => {
  const execute = vi.fn(async () => ({ code: 0, stdout: "[]", stderr: "" }));
  const create = vi.fn(() => ({ execute }));
  return { create, execute, recordDebug: vi.fn(), recentAction: vi.fn(() => true) };
});
vi.mock("@tauri-apps/plugin-shell", () => ({ Command: { create } }));
vi.mock("./debug-log.js", async (orig) => ({ ...(await orig<typeof import("./debug-log.js")>()), recordDebug, recentAction }));

import * as ipc from "./ipc.js";

describe("CLI calls in the debug log", () => {
  beforeEach(() => {
    recordDebug.mockReset();
    execute.mockReset();
    recentAction.mockReturnValue(true);
  });

  it("a read that succeeds is not written; one that fails is, with its error", async () => {
    execute.mockResolvedValue({ code: 0, stdout: "[]", stderr: "" });
    await ipc.listSessions(undefined, 20);
    expect(recordDebug).not.toHaveBeenCalled();
    execute.mockResolvedValue({ code: 1, stdout: "", stderr: "warn: x\nerror: no sessions folder\n    at main (index.js:3:1)\n\nNode.js v26.7.0\n" });
    // The caller may swallow it (an empty list); the log still has it.
    await ipc.listSessions(undefined, 20).catch(() => {});
    expect(recordDebug).toHaveBeenCalledWith(expect.objectContaining({ kind: "call", what: "sessions", ok: false, error: "error: no sessions folder", detail: { code: 1 } }));
  });

  it("a change is written by verb and key, never with the values it carried", async () => {
    execute.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    await ipc.renameSession("claude/w/abcd1234", "My secret title");
    const e = recordDebug.mock.calls[0][0];
    expect(e).toMatchObject({ kind: "call", what: "sessions name", key: "claude/w/abcd1234", ok: true });
    expect(JSON.stringify(e)).not.toContain("secret");
  });

  it("a change that succeeds with nothing done by the person a moment before is polling, and not written", async () => {
    recentAction.mockReturnValue(false);
    execute.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    await ipc.renameSession("claude/w/abcd1234", "x");
    expect(recordDebug).not.toHaveBeenCalled();
    execute.mockResolvedValue({ code: 1, stdout: "", stderr: "error: boom" });
    await ipc.renameSession("claude/w/abcd1234", "x").catch(() => {});
    expect(recordDebug, "a failure is written anyway").toHaveBeenCalledTimes(1);
  });

  it("a `--json` refusal with exit 0 counts as a failure", async () => {
    execute.mockResolvedValue({ code: 0, stdout: JSON.stringify({ ok: false, error: "a turn is running in the chat — switch after this turn" }), stderr: "" });
    await expect(ipc.viewSwitch("claude/w/abcd1234", "terminal")).rejects.toThrow(/switch after this turn/);
    expect(recordDebug).toHaveBeenCalledWith(expect.objectContaining({ what: "view", key: "claude/w/abcd1234", ok: false, error: "a turn is running in the chat — switch after this turn" }));
  });
});
