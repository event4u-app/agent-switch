import { Button } from "../ui/Button.js";
import { Dialog } from "../ui/Overlay.js";
import { useAS, type ConfirmRequest } from "../vm/store.js";
import { NearLimitSheet } from "./screens/near-limit.js";
import { Settings } from "./screens/settings/Settings.js";
import { Overview } from "./screens/overview.js";
import { SessionSheet } from "./screens/session-sheet.js";
import { Sessions } from "./screens/sessions.js";
import { StartSessionDialog } from "./screens/start-session.js";
import { TerminalSheet, terminalRun } from "./screens/terminal-sheet.js";
import { Activity } from "./screens/activity.js";
import { FixDialog } from "./screens/fix-dialog.js";
import { Health } from "./screens/health.js";
import { NotificationsSheet } from "./screens/notifications-sheet.js";
import { Tools } from "./screens/tools.js";
import { UpdateSheet } from "./screens/update-sheet.js";
import { AccountSheet } from "./screens/account-sheet.js";
import { Accounts } from "./screens/accounts.js";
import { AddAccountDialog } from "./screens/add-account.js";
import { ReauthDialog } from "./screens/reauth.js";

/** The current place (bundle `bR`). */
export function ScreenHost() {
  const { screen } = useAS();
  if (screen === "home") return <Overview />;
  if (screen === "sessions") return <Sessions />;
  if (screen === "accounts") return <Accounts />;
  if (screen === "tools") return <Tools />;
  if (screen === "health") return <Health />;
  if (screen === "activity") return <Activity />;
  return <Settings />;
}

/** Generic confirmation for destructive / irreversible actions (bundle `yR`). */
function ConfirmDialog({ title, body, confirm, danger, onConfirm }: ConfirmRequest) {
  const s = useAS();
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && s.close()}
      kicker="Please confirm"
      title={title}
      width={460}
      footer={
        <>
          <span className="flex-1" />
          <Button size="sm" variant="ghost" onClick={() => s.close()}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant={danger ? "danger" : "primary"}
            onClick={() => {
              s.close();
              onConfirm();
            }}
          >
            {confirm}
          </Button>
        </>
      }
    >
      <p className="text-[13px] text-ac-soft [text-wrap:pretty]">{body}</p>
    </Dialog>
  );
}

/** The single overlay slot (bundle `SR`). */
export function OverlayHost() {
  const s = useAS();
  const o = s.overlay;
  if (o.kind === "none") return null;
  if (o.kind === "confirm") return <ConfirmDialog {...o} />;
  if (o.kind === "session") return <SessionSheet key={o.id} id={o.id} />;
  if (o.kind === "start") return <StartSessionDialog cwd={o.cwd} tool={o.tool} accountId={o.accountId} />;
  if (o.kind === "limit") return <NearLimitSheet key={o.attentionId} attentionId={o.attentionId} />;
  if (o.kind === "terminal")
    return "run" in o ? <TerminalSheet run={terminalRun(o)} /> : <UpdateSheet key={`${o.toolId}:${o.action}`} toolId={o.toolId} action={o.action} />;
  if (o.kind === "fix") return <FixDialog key={o.checkId} checkId={o.checkId} />;
  if (o.kind === "notifications") return <NotificationsSheet />;
  if (o.kind === "account") return <AccountSheet key={o.id} id={o.id} section={o.section} />;
  if (o.kind === "add-account") return <AddAccountDialog tool={o.tool} />;
  return <ReauthDialog key={o.accountId} accountId={o.accountId} />;
}
