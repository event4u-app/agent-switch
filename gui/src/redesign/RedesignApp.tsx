import { setNotifLastRead } from "../settings-store.js";
import { AcRoot } from "../ui/AcRoot.js";
import { Toaster } from "../ui/Toaster.js";
import { createAccountActions, createActions, type Actions } from "../vm/actions.js";
import { createFoundationActions } from "../vm/actions-foundations.js";
import { emptyViewModel, loadViewModel } from "../vm/load.js";
import { ASProvider, useAS } from "../vm/store.js";
import type { ViewModel } from "../vm/types.js";
import { OverlayHost, ScreenHost } from "./Hosts.js";
import { Shell } from "./Shell.js";
import { useTrayRequests } from "./tray/bridge.js";

/** One `act`: the session/tool actions, the foundation readouts (protection,
 *  pools, folder rules) and the account extras. */
function allActions(getVm: () => ViewModel, reload: () => Promise<void>): Actions {
  return { ...createActions(getVm, reload), ...createFoundationActions(getVm, reload), ...createAccountActions() };
}

function StoreToaster() {
  const s = useAS();
  return <Toaster toasts={s.toasts} onDismiss={s.dismissToast} />;
}

function Frame() {
  const s = useAS();
  useTrayRequests(s.open);
  return (
    <>
      <Shell isMac={s.platform === "mac"}>
        <ScreenHost />
      </Shell>
      <OverlayHost />
      <StoreToaster />
    </>
  );
}

/** The redesigned window, fed by the real CLI (bundle `jR`). Mounted only
 *  behind the redesign flag — see flag.ts. */
export default function RedesignApp() {
  return (
    <AcRoot className="h-full">
      <ASProvider initial={emptyViewModel()} load={loadViewModel} actions={allActions} onNoticesRead={setNotifLastRead}>
        <Frame />
      </ASProvider>
    </AcRoot>
  );
}
