/**
 * Sessions between full reloads. A full reload (usage, tooling, doctor …) runs
 * on the refresh interval, minutes apart, so a session started in a terminal
 * stayed invisible until then. The session list is a local read with no
 * network, so it is re-read on its own: every {@link SESSIONS_POLL_MS}, and
 * every second tick with the window hidden — the pet and desktop alerts must
 * still tell when a session waits while the window is in the background.
 *
 * A session that starts waiting on the user is told once, through the
 * notification log — the pet, the bell and desktop alerts follow their own
 * settings. The first read after start is the baseline and tells nothing.
 */

import { useEffect, useRef } from "react";
import { listSessions } from "../../ipc.js";
import type { SessionRow } from "../../transforms.js";
import { sessionFromRow } from "../../vm/build.js";
import { useAS } from "../../vm/store.js";
import { notify } from "./bus.js";
import type { Account, Session, ViewModel } from "../../vm/types.js";

export const SESSIONS_POLL_MS = 10_000;

/** The sessions and each Claude account's running count (`sessions` reports
 *  Claude only) from one read; other tools keep what `list` reported. */
export function sessionsPatch(accounts: readonly Account[], rows: readonly SessionRow[], now: number): Partial<ViewModel> {
  const sessions = rows.map((r) => sessionFromRow(r, now));
  const running = new Map<string, number>();
  for (const x of sessions) if (x.state !== "done" && x.accountId) running.set(x.accountId, (running.get(x.accountId) ?? 0) + 1);
  return {
    sessions,
    accounts: accounts.map((a) => (a.tool === "claude" ? { ...a, liveSessions: running.get(a.id) ?? 0 } : a)),
  };
}

/** One wait: the session and what it waits on, so a second question right
 *  after the first is a new one even with no poll in between. */
const waitKey = (x: Session) => `${x.id}|${x.waitingFor ?? ""}`;

/** Waits now open that weren't at the last read. */
export function newlyWaiting(before: ReadonlySet<string>, sessions: readonly Session[]): Session[] {
  return sessions.filter((x) => x.state === "needs-you" && !before.has(waitKey(x)));
}

export function useSessionsPoll(): void {
  const s = useAS();
  const sRef = useRef(s);
  sRef.current = s;
  useEffect(() => {
    let busy = false;
    let waiting: Set<string> | null = null;
    let tick = 0;
    const poll = async () => {
      if (busy) return;
      busy = true;
      try {
        const rows = await listSessions(undefined, 50);
        const patch = sessionsPatch(sRef.current.accounts, rows, Date.now());
        sRef.current.update((vm) => sessionsPatch(vm.accounts, rows, Date.now()));
        const sessions = patch.sessions ?? [];
        if (waiting) {
          for (const x of newlyWaiting(waiting, sessions)) {
            const name = sRef.current.accountById(x.accountId)?.name ?? x.accountId;
            void notify("warning", `${x.project} is waiting for you`, `A session on ${name} asks you something.`, { repeat: true });
          }
        }
        waiting = new Set(sessions.filter((x) => x.state === "needs-you").map(waitKey));
      } catch {
        /* the next full reload reports it */
      } finally {
        busy = false;
      }
    };
    const id = setInterval(() => {
      tick++;
      if (document.visibilityState === "hidden" && tick % 2 === 1) return;
      void poll();
    }, SESSIONS_POLL_MS);
    const onShow = () => document.visibilityState === "visible" && void poll();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, []);
}
