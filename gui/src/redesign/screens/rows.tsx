import type { MouseEvent, ReactNode } from "react";
import { Download, KeyRound, LogIn, Stethoscope, TriangleAlert } from "lucide-react";
import { cn } from "../../lib/utils.js";
import { AccountDot } from "../../ui/AccountDot.js";
import { Badge } from "../../ui/Badge.js";
import { Button } from "../../ui/Button.js";
import { CapacityMeter } from "../../ui/Meters.js";
import { SessionStateIcon } from "../../ui/SessionStateIcon.js";
import { ago, duration, shortPath } from "../../ui/format.js";
import { bindingWindow, SESSION_STATE_LABEL, TOOL_LABEL, type RankedAccount } from "../../vm/rules.js";
import { useAS, type Store } from "../../vm/store.js";
import type { Account, Attention, AttentionKind, Session, SessionState } from "../../vm/types.js";

const ROW_STOP =
  'button:not([data-row-main]), a, input, select, textarea, label, [role="switch"], [role="menuitem"], [role="combobox"], [role="listbox"], [data-row-stop]';

/** Whole row clickable except its own interactive children. Bundle `yo`. */
export function rowClick(run: () => void) {
  return {
    onClick: (e: MouseEvent<HTMLElement>) => {
      if (!(e.target as HTMLElement).closest(ROW_STOP)) run();
    },
  };
}

/** Divided list inside a Card. Bundle `Yi`. */
export function RowList({ children }: { children: ReactNode }) {
  return <div className="flex flex-col divide-y divide-ac-line">{children}</div>;
}

/** Account state badge. Bundle `Gi`. */
export function AccountStateBadge({ account }: { account: Account }) {
  switch (account.state) {
    case "near-limit":
      return (
        <Badge tone="warn" dot>
          Near limit
        </Badge>
      );
    case "limited":
      return (
        <Badge tone="alert" dot>
          At limit
        </Badge>
      );
    case "signed-out":
      return <Badge tone="neutral">Sign-in needed</Badge>;
    case "wrong-account":
      return (
        <Badge tone="alert" dot>
          Wrong account
        </Badge>
      );
    case "checking":
      return <Badge tone="neutral">Checking sign-in</Badge>;
    default:
      return null;
  }
}

function hasStateBadge(a: Account): boolean {
  return a.state !== "ready";
}

/** Compact account row for Overview "What's left" and the tray. Bundle `Bd` (compact). */
export function CompactAccountRow({ account: a, nextIn }: { account: Account; ranked?: RankedAccount; nextIn?: string }) {
  const s = useAS();
  const signedOut = a.state === "signed-out";
  return (
    <div
      {...rowClick(() => s.open({ kind: "account", id: a.id }))}
      className="grid cursor-pointer grid-cols-[minmax(0,1fr)_minmax(120px,168px)] items-center gap-x-4 gap-y-2 rounded-lg px-3 py-2.5 transition-colors hover:bg-ac-raise"
    >
      <button type="button" data-row-main className="flex min-w-0 items-center gap-3 text-left">
        <AccountDot color={a.color} ring={a.liveSessions > 0} />
        <span className="flex min-w-0 flex-col">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[13px] font-medium text-ac-text">{a.name}</span>
          </span>
          {nextIn || hasStateBadge(a) ? (
            <span className="mt-1 flex min-w-0 items-center gap-1.5">
              <AccountStateBadge account={a} />
              {nextIn && <Badge tone="info">Next in {nextIn}</Badge>}
            </span>
          ) : (
            <span className="truncate text-[11px] text-ac-muted">
              {signedOut && !a.identity
                ? ["Not signed in yet", a.label].filter(Boolean).join(" · ")
                : [a.identity, a.plan, a.label].filter(Boolean).join(" · ")}
            </span>
          )}
        </span>
      </button>
      <div>
        {signedOut ? (
          <span className="text-[11px] text-ac-faint">{a.windows.length ? "Waits for sign-in" : "No usage yet"}</span>
        ) : (
          <CapacityMeter window={bindingWindow(a.windows)} threshold={a.threshold} checkedAt={a.checkedAt} now={s.now} compact />
        )}
      </div>
    </div>
  );
}

const SECONDARY_STATES: ReadonlySet<SessionState> = new Set(["needs-you", "waiting", "pause-requested", "parked", "auth-paused"]);
const SESSION_GRID = "md:grid-cols-[minmax(0,1.3fr)_minmax(140px,0.8fr)_64px_84px_auto]";

/** Column header of the full session list. Bundle `hP`. */
export function SessionColumns() {
  return (
    <div className={cn("hidden gap-x-4 px-3 pb-1 md:grid", SESSION_GRID)}>
      <span className="ac-caps pl-5">Session</span>
      <span className="ac-caps">Runs on</span>
      <span className="ac-caps text-right">Context</span>
      <span className="ac-caps text-right">Time</span>
      <span className="ac-caps w-[68px] text-right">&nbsp;</span>
    </div>
  );
}

function decide(s: Store, session: Session) {
  const item = s.attention.find((a) => a.sessionId === session.id);
  if (item) s.open({ kind: "limit", attentionId: item.id });
  else s.open({ kind: "session", id: session.id });
}

/** Bundle `g0`. */
export function SessionRow({ session: e, compact }: { session: Session; compact?: boolean }) {
  const s = useAS();
  const account = s.accountById(e.accountId);
  const ctxTone = e.contextPct == null ? "text-ac-faint" : e.contextPct >= 80 ? "text-ac-warn-text" : "text-ac-soft";
  return (
    <div
      {...rowClick(() => s.open({ kind: "session", id: e.id }))}
      className={cn(
        "grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 rounded-lg px-3 py-2.5 transition-colors hover:bg-ac-raise",
        compact ? "md:grid-cols-[minmax(0,1fr)_minmax(110px,150px)_72px_auto]" : SESSION_GRID,
      )}
    >
      <button type="button" data-row-main className="flex min-w-0 items-center gap-3 text-left">
        <SessionStateIcon state={e.state} />
        <span className="flex min-w-0 flex-col">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[13px] font-medium text-ac-text">{e.project}</span>
          </span>
          <span className="truncate text-[11px] text-ac-muted">
            {SECONDARY_STATES.has(e.state) && (
              <span
                className={cn(
                  "font-medium",
                  e.state === "needs-you" || e.state === "pause-requested" || e.state === "auth-paused" ? "text-ac-warn-text" : "text-ac-soft",
                )}
              >
                {SESSION_STATE_LABEL[e.state]} ·{" "}
              </span>
            )}
            {e.title}
            {e.branch ? ` · ${e.branch}` : ""}
          </span>
        </span>
      </button>
      <span className="hidden min-w-0 items-center gap-2 md:flex">
        {account && <AccountDot color={account.color} size={8} />}
        <span className="truncate text-xs text-ac-soft">
          {TOOL_LABEL[e.tool]} · {account?.name ?? "?"}
        </span>
      </span>
      <span className={cn("hidden text-right font-ac-mono text-[11px] tabular-nums", !compact && "md:block", ctxTone)} title="Context window used">
        {e.contextPct == null ? "—" : `${e.contextPct}%`}
      </span>
      <span className="hidden text-right text-[11px] text-ac-faint md:block" title={shortPath(e.cwd)}>
        {e.state === "working" ? duration(e.startedAt, s.now) : ago(e.lastActiveAt, s.now)}
      </span>
      <div className="flex min-w-[68px] items-center justify-end gap-1">
        {e.state === "needs-you" ? (
          <Button size="sm" variant="primary" onClick={() => decide(s, e)}>
            Decide
          </Button>
        ) : e.state === "auth-paused" ? (
          <Button size="sm" variant="primary" onClick={() => s.open({ kind: "reauth", accountId: e.accountId })}>
            Sign in
          </Button>
        ) : null}
      </div>
    </div>
  );
}

const ATTENTION_ICON: Record<AttentionKind, ReactNode> = {
  "near-limit": <TriangleAlert className="size-4 text-ac-warn" />,
  "signed-out": <LogIn className="size-4 text-ac-info" />,
  reauth: <KeyRound className="size-4 text-ac-warn" />,
  health: <Stethoscope className="size-4 text-ac-warn" />,
  update: <Download className="size-4 text-ac-info" />,
};

/** What the primary button of an attention item does. */
export function runAttention(s: Store, item: Attention) {
  if (item.kind === "near-limit") s.open({ kind: "limit", attentionId: item.id });
  else if ((item.kind === "signed-out" || item.kind === "reauth") && item.accountId) s.open({ kind: "reauth", accountId: item.accountId });
  else if (item.kind === "update") {
    s.go("tools");
    s.setToolsTab("tools");
  } else s.go("health");
}

/** Bundle `_P`. */
export function AttentionRow({ item }: { item: Attention }) {
  const s = useAS();
  const run = () => runAttention(s, item);
  const flagged = item.kind === "near-limit" || item.kind === "reauth";
  return (
    <div
      {...rowClick(run)}
      className="grid cursor-pointer grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-x-3 transition-colors hover:bg-ac-raise gap-y-2 px-4 py-3 sm:grid-cols-[20px_minmax(0,1fr)_72px_auto]"
      style={flagged ? { boxShadow: "inset 3px 0 0 var(--ac-warn)" } : undefined}
    >
      <span className="flex items-center">{ATTENTION_ICON[item.kind]}</span>
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-ac-text">{item.title}</p>
        <p className="mt-0.5 text-xs text-ac-muted">{item.detail}</p>
      </div>
      <span className="hidden text-right text-[11px] text-ac-faint sm:block">{ago(item.at, s.now)}</span>
      <div className="col-span-3 flex justify-end gap-2 sm:col-span-1">
        {item.kind !== "near-limit" && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => s.update((vm) => ({ attention: vm.attention.filter((a) => a.id !== item.id) }))}
            title="Remind me later — once"
          >
            Later
          </Button>
        )}
        <Button size="sm" variant="primary" className="min-w-[72px]" onClick={run}>
          {item.primary}
        </Button>
      </div>
    </div>
  );
}
