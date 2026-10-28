import { setNotifLastRead } from "../settings-store.js";
import { AcRoot } from "../ui/AcRoot.js";
import { Toaster } from "../ui/Toaster.js";
import { createActions } from "../vm/actions.js";
import { emptyViewModel, loadViewModel } from "../vm/load.js";
import { ASProvider, useAS } from "../vm/store.js";
import { OverlayHost, ScreenHost } from "./Hosts.js";
import { Shell } from "./Shell.js";

function StoreToaster() {
  const s = useAS();
  return <Toaster toasts={s.toasts} onDismiss={s.dismissToast} />;
}

function Frame() {
  const s = useAS();
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
      <ASProvider initial={emptyViewModel()} load={loadViewModel} actions={createActions} onNoticesRead={setNotifLastRead}>
        <Frame />
      </ASProvider>
    </AcRoot>
  );
}
