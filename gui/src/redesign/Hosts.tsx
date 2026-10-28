import { Button } from "../ui/Button.js";
import { EmptyState } from "../ui/Card.js";
import { Dialog, Sheet } from "../ui/Overlay.js";
import { PageHeader } from "../ui/Typography.js";
import { useAS, type ConfirmRequest, type Overlay, type Screen } from "../vm/store.js";

const SCREEN_HEADER: Record<Screen, [string, string]> = {
  home: ["What's going on?", "What needs you, what runs and what is left."],
  sessions: ["What runs on which account?", "Every session with its account, its protection state and why it got that account."],
  accounts: [
    "Who is signed in where?",
    "Each account with its sign-in, where it is used, what is left and whether its sessions are protected.",
  ],
  tools: [
    "Which tools does it look after?",
    "agent-config, rtk and the agent CLIs — installed, current, and where Agent Switch reaches into your apps.",
  ],
  activity: ["What happened?", "Starts, bindings, pauses, sign-ins and repairs — with the reason for each."],
  health: ["Is everything working?", "Background readiness and checks with repairs."],
  settings: ["How should it behave?", "Start at login, protection, notifications, pet, updates."],
};

/** Placeholder per place until the screens lane lands (bundle `bR`). */
export function ScreenHost() {
  const { screen } = useAS();
  const [title, sub] = SCREEN_HEADER[screen];
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={title} sub={sub} />
      <EmptyState title="This screen is being rebuilt." detail="Use the classic window for it until the redesign is complete." />
    </div>
  );
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

const OVERLAY_TITLE: Record<Exclude<Overlay["kind"], "none" | "confirm">, [string, "sheet" | "dialog", number]> = {
  session: ["Session", "sheet", 500],
  account: ["Account", "sheet", 500],
  start: ["Start session", "dialog", 580],
  "add-account": ["Add account", "dialog", 600],
  limit: ["Near limit", "sheet", 460],
  notifications: ["Notifications", "sheet", 420],
  reauth: ["Sign in again", "dialog", 540],
  fix: ["Fix it", "dialog", 520],
  terminal: ["Update", "sheet", 520],
};

/** The single overlay slot (bundle `SR`). Real overlays arrive with the screens lane. */
export function OverlayHost() {
  const s = useAS();
  const o = s.overlay;
  if (o.kind === "none") return null;
  if (o.kind === "confirm") return <ConfirmDialog {...o} />;
  const [kicker, shape, width] = OVERLAY_TITLE[o.kind];
  const Frame = shape === "sheet" ? Sheet : Dialog;
  return (
    <Frame open onOpenChange={(open) => !open && s.close()} kicker={kicker} title="Not built yet" width={width}>
      <EmptyState title="This panel is being rebuilt." detail="Use the classic window for it until the redesign is complete." />
    </Frame>
  );
}
