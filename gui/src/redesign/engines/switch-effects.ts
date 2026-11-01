/**
 * Side effects every account switch carried in the classic window, wrapped
 * around the plain `act` seam so each caller (Accounts, the account sheet, the
 * tray, ⌘K) gets them identically:
 *
 * - a "switch" notification when Settings › Notifications › "Notify on account
 *   switch" is on (kind success → desktop, toast and the pet route it);
 * - the shared setup's links are re-synced after the switch when sharing is on.
 */

import { shareStatus, shareSync } from "../../ipc.js";
import { getNotifyOnSwitch, getShareSource } from "../../settings-store.js";
import type { ProviderId } from "../../transforms.js";
import { splitAccountId, type Actions } from "../../vm/actions.js";
import { TOOL_LABEL } from "../../vm/rules.js";
import type { ViewModel } from "../../vm/types.js";
import { notify } from "./bus.js";
import { noticeEn } from "./notice-text.js";

export interface SwitchEffectDeps {
  notifyOnSwitch(): boolean;
  relink(): Promise<void>;
  notify: typeof notify;
}

const defaults: SwitchEffectDeps = {
  notifyOnSwitch: getNotifyOnSwitch,
  relink: async () => {
    const st = await shareStatus();
    if (st.active) await shareSync(getShareSource());
  },
  notify,
};

export function withSwitchEffects(a: Actions, getVm: () => ViewModel, d: SwitchEffectDeps = defaults): Actions {
  const relink = () => d.relink().catch(() => {});
  const announce = (title: string, message: string) => (d.notifyOnSwitch() ? d.notify("success", title, message) : Promise.resolve());
  const out: Actions = { ...a };
  if (a.setDefault) {
    const setDefault = a.setDefault;
    out.setDefault = async (id: string) => {
      await setDefault(id);
      await relink();
      const [tool, name] = splitAccountId(id);
      await announce(noticeEn("engines.notice.switchedTitle"), noticeEn("engines.notice.switchedBody", { tool: TOOL_LABEL[tool], name }));
    };
  }
  if (a.deactivate) {
    const deactivate = a.deactivate;
    out.deactivate = async (tool: ProviderId) => {
      const name = getVm().accounts.find((x) => x.tool === tool && x.isDefault)?.name ?? null;
      await deactivate(tool);
      await announce(
        noticeEn("engines.notice.deactivatedTitle"),
        name
          ? noticeEn("engines.notice.deactivatedBodyNamed", { tool: TOOL_LABEL[tool], name })
          : noticeEn("engines.notice.deactivatedBody", { tool: TOOL_LABEL[tool] }),
      );
    };
  }
  if (a.rebind) {
    const rebind = a.rebind;
    out.rebind = async (sessionId: string, target: string) => {
      await rebind(sessionId, target);
      await relink();
    };
  }
  return out;
}
