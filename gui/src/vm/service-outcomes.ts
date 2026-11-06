/**
 * Tell the user what the background service did with a move answered in the app:
 * one notice per finished request, with the resume on one click when the session
 * has to be resumed by hand.
 */
import { useEffect, useRef } from "react";
import type { SwitchRequestRow } from "../ipc.js";
import { t } from "../i18n/index.js";
import type { Overlay, Toast } from "./store.js";
import { resumeArgs, serviceOutcomes } from "./switch-requests.js";
export function useServiceOutcomes(
  rows: readonly SwitchRequestRow[],
  ui: { toast: (t: Omit<Toast, "id">) => void; open: (o: Overlay) => void },
  since: number = Date.now(),
): void {
  // Only what finishes while this window is open; read once per window.
  const start = useRef(since);
  const told = useRef(new Set<string>());
  useEffect(() => {
    for (const r of serviceOutcomes(rows, start.current)) {
      if (told.current.has(r.id)) continue;
      told.current.add(r.id);
      const o = r.outcome!;
      const target = r.decision?.target ?? "";
      if (!o.ok) {
        ui.toast({ tone: "alert", text: t("sessions.service.failed", { account: r.account, target, detail: o.detail }) });
        continue;
      }
      const args = o.resume ? resumeArgs(o.resume) : null;
      ui.toast({
        tone: "ok",
        text: t(args ? "sessions.service.doneResume" : "sessions.service.done", { account: r.account, target, detail: o.detail }),
        ...(args ? { action: { label: t("sessions.service.resume"), run: () => ui.open({ kind: "terminal", run: { args, title: t("sessions.service.resumeTitle", { target }) } }) } } : {}),
      });
    }
  }, [rows, ui]);
}
