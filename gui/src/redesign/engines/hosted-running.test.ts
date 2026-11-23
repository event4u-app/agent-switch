import { describe, expect, it, vi } from "vitest";
import type { HostList } from "../../v3/adapter/feeds.js";

const ipc = vi.hoisted(() => ({ hostList: async (): Promise<HostList> => ({ mode: "persistent", hosted: [] }) }));
vi.mock("../../ipc.js", async (orig) => ({ ...(await orig<typeof import("../../ipc.js")>()), hostList: () => ipc.hostList() }));

import { hostedSessionsRunning } from "./updates.js";

const row = (sessionId: string, alive: boolean) => ({ key: `claude/work/${sessionId}`, provider: "claude", account: "work", sessionId, cwd: "/r", startedAt: "", alive, parked: false });

describe("hostedSessionsRunning", () => {
  it("counts the alive hosted sessions plus the chats this window runs", async () => {
    ipc.hostList = async () => ({ mode: "persistent", hosted: [row("a", true), row("b", false), row("c", true)] });
    await expect(hostedSessionsRunning(() => 2)).resolves.toBe(4);
    await expect(hostedSessionsRunning()).resolves.toBe(2);
  });

  it("is 0 with nothing hosted and no chats", async () => {
    ipc.hostList = async () => ({ mode: "ephemeral", hosted: [row("a", false)] });
    await expect(hostedSessionsRunning(() => 0)).resolves.toBe(0);
  });

  it("throws when the host list cannot be read, so a caller counts it as running instead of 0", async () => {
    ipc.hostList = async () => {
      throw new Error("engine down");
    };
    await expect(hostedSessionsRunning(() => 0)).rejects.toThrow("engine down");
    await expect(hostedSessionsRunning(() => 0).then((n) => n > 0, () => true)).resolves.toBe(true);
  });
});
