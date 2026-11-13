import { describe, expect, it, vi } from "vitest";
import type { Store } from "../../vm/store.js";
import type { Session, ViewModel } from "../../vm/types.js";
import type { RankedAccount } from "../../vm/rules.js";
import { restoreSessionFrom, targetOptions } from "./session-sheet.js";

const session = { id: "claude:a", tool: "claude", accountId: "claude:work", project: "a", trashed: true } as Session;

function fakeStore(restore: () => Promise<void>) {
  let sessions: Session[] = [session];
  const toast = vi.fn();
  const s = {
    act: { restoreSession: vi.fn(restore) },
    toast,
    update: (patch: (vm: ViewModel) => Partial<ViewModel>) => {
      sessions = patch({ sessions } as ViewModel).sessions ?? sessions;
    },
  } as unknown as Store;
  return { s, toast, trashed: () => sessions[0].trashed };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("restore from the trash", () => {
  it("leaves the session in the trash until the restore succeeded", async () => {
    let done!: () => void;
    const f = fakeStore(() => new Promise<void>((r) => (done = r)));
    restoreSessionFrom(f.s, session);
    expect(f.trashed()).toBe(true);
    done();
    await flush();
    expect(f.trashed()).toBe(false);
  });

  it("a failed restore keeps it in the trash and says so", async () => {
    const f = fakeStore(async () => {
      throw new Error("gone");
    });
    restoreSessionFrom(f.s, session);
    await flush();
    expect(f.trashed()).toBe(true);
    expect(f.toast).toHaveBeenCalledWith({ text: "Restore failed: gone", tone: "alert" });
  });
});

describe("live-switch targets", () => {
  const ranked = (name: string, liveSessions: number, rank: number | null) =>
    ({ account: { id: `claude:${name}`, tool: "claude", name, color: "#000", windows: [], liveSessions }, headroom: null, rank, reason: "" }) as unknown as RankedAccount;

  it("an account running a session of its own is listed but cannot be picked for a live switch", () => {
    const opts = targetOptions([ranked("ArturB", 1, 1), ranked("Matze", 0, 2)], { liveSwitch: true });
    expect(opts.map((o) => [o.value, !!o.disabled])).toEqual([
      ["claude:ArturB", true],
      ["claude:Matze", false],
    ]);
    expect(opts[0].hint).toMatch(/own session is running/);
  });

  it("takeover and hand-off may still use a busy account", () => {
    const opts = targetOptions([ranked("ArturB", 2, 1)]);
    expect(opts[0].disabled).toBeUndefined();
  });
});
