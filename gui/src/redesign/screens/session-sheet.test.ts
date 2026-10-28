import { describe, expect, it, vi } from "vitest";
import type { Store } from "../../vm/store.js";
import type { Session, ViewModel } from "../../vm/types.js";
import { restoreSessionFrom } from "./session-sheet.js";

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
