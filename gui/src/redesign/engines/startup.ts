/**
 * One-off and reconcile work the classic window did on open:
 *
 * - push the persisted "minimize into Dock" preference to Rust so the native
 *   window-event handler matches the UI from the first minimize;
 * - reconcile shared setup toward its (default-on) preference: link profiles
 *   that are not linked yet (first launch, a freshly added account), or remove
 *   the links when the preference is off. Re-runs when the set of Claude
 *   accounts changes, which is how a new sign-in inherits the shared tree.
 *
 * Theme and launch-at-login are applied before first paint in main.tsx.
 */

import { useEffect } from "react";
import { setMinimizeToDock, shareOff, shareOn, shareStatus, type ShareStatus } from "../../ipc.js";
import { getMinimizeToDock, getShareGlobal, getShareSource } from "../../settings-store.js";
import { useAS } from "../../vm/store.js";

export interface ShareDeps {
  status(): Promise<ShareStatus>;
  on(source: string): Promise<void>;
  off(): Promise<void>;
  pref(): boolean;
  source(): string;
}

const shareDeps: ShareDeps = { status: shareStatus, on: shareOn, off: shareOff, pref: getShareGlobal, source: getShareSource };

/** Returns what it did. No profiles → nothing to link (the CLI refuses). */
export async function reconcileShare(d: ShareDeps = shareDeps): Promise<"linked" | "unlinked" | "none"> {
  const s = await d.status();
  if (s.profiles.length === 0) return "none";
  if (d.pref() && s.profiles.some((p) => !p.shared)) {
    await d.on(d.source());
    return "linked";
  }
  if (!d.pref() && s.active) {
    await d.off();
    return "unlinked";
  }
  return "none";
}

export function useStartupEngines(): void {
  const s = useAS();
  useEffect(() => {
    void setMinimizeToDock(getMinimizeToDock()).catch(() => {});
  }, []);

  const claudeKey = s.readiness === "starting" ? null : s.accounts.filter((a) => a.tool === "claude").map((a) => a.name).sort().join("\n");
  useEffect(() => {
    if (claudeKey === null) return;
    void reconcileShare().catch(() => {});
  }, [claudeKey]);
}
