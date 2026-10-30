import { useState } from "react";
import { ArchiveRestore, ArrowLeftRight, ChevronDown, Copy, Eye, Minimize2, ShieldCheck, Trash2 } from "lucide-react";
import { compactArgs, handoffSeedArgs, takeoverArgs } from "../../ipc.js";
import type { ProviderId } from "../../transforms.js";
import { cn } from "../../lib/utils.js";
import { AccountDot } from "../../ui/AccountDot.js";
import { Badge } from "../../ui/Badge.js";
import { Button } from "../../ui/Button.js";
import { DefinitionList } from "../../ui/Card.js";
import { Sheet } from "../../ui/Overlay.js";
import { Segmented } from "../../ui/Segmented.js";
import { Select, type SelectOption } from "../../ui/Select.js";
import { SessionStateIcon } from "../../ui/SessionStateIcon.js";
import { Switch } from "../../ui/Switch.js";
import { Caps } from "../../ui/Typography.js";
import { ago, duration, shortPath } from "../../ui/format.js";
import { splitAccountId } from "../../vm/actions.js";
import { maxUtilization, rankAccounts, TOOL_LABEL, type RankedAccount } from "../../vm/rules.js";
import { useAS, type Store } from "../../vm/store.js";
import type { Session } from "../../vm/types.js";
import { isRunning, liveSwitch, sessionHandle } from "./logic.js";

type MoveHow = "switch" | "takeover" | "handoff";

/** Trash handles from this run (Claude's trash id) so Undo / Restore can find
 *  the trashed copy; Codex restores by its own session id. */
const trashHandles = new Map<string, string>();

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Restore a trashed session; it leaves the Trash only once the CLI restored it. */
export function restoreSessionFrom(s: Store, session: Session) {
  const handle = trashHandles.get(session.id) ?? sessionHandle(session);
  s.act
    .restoreSession?.(session.id, handle)
    .then(() => {
      trashHandles.delete(session.id);
      s.update((vm) => ({ sessions: vm.sessions.map((x) => (x.id === session.id ? { ...x, trashed: false } : x)) }));
    })
    .catch((e) => s.toast({ text: `Restore failed: ${errorText(e)}`, tone: "alert" }));
}

function trash(s: Store, session: Session) {
  s.close();
  s.act
    .trashSession?.(session.id)
    .then(({ trashId }) => {
      if (trashId) trashHandles.set(session.id, trashId);
      const canUndo = session.tool === "codex" || !!trashId;
      // The reload dropped it; keep the trashed copy so the Trash view and Undo can reach it.
      s.update((vm) => ({ sessions: [...vm.sessions.filter((x) => x.id !== session.id), { ...session, trashed: true }] }));
      s.toast({
        text: `${session.project} moved to the trash.`,
        action: canUndo ? { label: "Undo", run: () => restoreSessionFrom(s, { ...session, trashed: true }) } : undefined,
      });
    })
    .catch((e) => s.toast({ text: `Couldn't move ${session.project} to the trash: ${errorText(e)}`, tone: "alert" }));
}

/** Options for a same-tool target account. */
export function targetOptions(ranked: readonly RankedAccount[]): SelectOption[] {
  return ranked.map((r) => {
    const max = maxUtilization(r.account.windows);
    return {
      value: r.account.id,
      label: `${TOOL_LABEL[r.account.tool]} · ${r.account.name}`,
      hint: max != null ? `${max} % used${r.rank === 1 ? " · most headroom" : ""}` : "usage n/a",
      dot: <AccountDot color={r.account.color} size={8} />,
    };
  });
}

function Preview({ s, session }: { s: Store; session: Session }) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<{ role: "you" | "agent"; text: string }[] | null>(null);
  const toggle = () => {
    setOpen((o) => !o);
    if (turns == null)
      s.act
        .previewSession?.(session.id)
        .then(setTurns)
        .catch(() => setTurns([]));
  };
  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={toggle} className="flex items-center gap-2 text-left" aria-expanded={open}>
        <Eye className="size-3.5 text-ac-muted" />
        <Caps>Preview</Caps>
        <ChevronDown className={cn("ml-auto size-4 text-ac-muted transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="flex flex-col gap-2 rounded-lg border border-ac-line bg-ac-bg p-3">
          {turns == null ? (
            <p className="text-xs text-ac-muted">Reading …</p>
          ) : turns.length ? (
            turns.map((t, i) => (
              <p key={i} className="text-xs">
                <span className={cn("mr-2 font-ac-mono text-[10px] uppercase tracking-wider", t.role === "you" ? "text-ac-brand-text" : "text-ac-info-text")}>
                  {t.role === "you" ? "You" : "Agent"}
                </span>
                <span className="text-ac-soft">{t.text}</span>
              </p>
            ))
          ) : (
            <p className="text-xs text-ac-muted">No turns to show.</p>
          )}
          <p className="text-[11px] text-ac-faint">First turns only, read on demand. Hidden when “Hide session summaries” is on.</p>
        </div>
      )}
    </div>
  );
}

/** Bundle `$P`, sheet 500. */
export function SessionSheet({ id }: { id: string }) {
  const s = useAS();
  const n = s.sessions.find((x) => x.id === id);
  const sameTool = n ? rankAccounts(s.accounts, n.tool, s.now).filter((r) => r.account.id !== n.accountId) : [];
  const otherTool = n
    ? s.accounts.filter((a) => a.tool !== n.tool && a.tool !== "gemini" && a.state !== "signed-out" && a.state !== "wrong-account")
    : [];
  const live = !n
    ? { ok: false, reason: "" }
    : n.surface === "desktop-app"
      ? { ok: false, reason: "A Claude Desktop session keeps its window's sign-in — take it over instead." }
      : liveSwitch(n, s.platform);
  const [how, setHow] = useState<MoveHow>(live.ok ? "switch" : "takeover");
  const [target, setTarget] = useState(sameTool.find((r) => r.rank != null)?.account.id ?? "");
  const [handTo, setHandTo] = useState(otherTool[0]?.id ?? "");
  const [keepCopy, setKeepCopy] = useState(false);
  const [showBrief, setShowBrief] = useState(false);
  const [brief, setBrief] = useState<{ to: string; brief: string; briefPath: string } | null>(null);
  const [copied, setCopied] = useState(false);
  if (!n) return null;

  const account = s.accountById(n.accountId);
  const running = isRunning(n);
  // Its transcript is Desktop's (~/.claude), not the profile's: the CLI's
  // trash / compact can't reach it; take over re-files it in Desktop.
  const desktop = n.surface === "desktop-app";
  const handle = sessionHandle(n);
  const profile = splitAccountId(n.accountId)[1];
  const options = targetOptions(sameTool);
  const targetAccount = s.accountById(target);
  const handAccount = s.accountById(handTo);

  const loadBrief = async (to: string) => {
    if (brief?.to === to) return brief;
    const b = await s.act.handoffBrief!(n.id, to);
    const next = { to, ...b };
    setBrief(next);
    return next;
  };

  const switchLive = () =>
    s.open({
      kind: "confirm",
      title: `Switch ${n.project} to ${targetAccount?.name}?`,
      body: "The running session adopts the new sign-in with its next message. Its transcript stays where it is. If the switch fails, the session keeps its current account and nothing is lost.",
      confirm: "Switch account",
      onConfirm: () => {
        s.act
          .rebind?.(n.id, target)
          .then(() => s.toast({ text: `${n.project} now runs on ${targetAccount?.name}.`, tone: "ok" }))
          .catch((e) => s.toast({ text: `Switch failed — ${n.project} stays on ${account?.name}. ${errorText(e)}`, tone: "alert" }));
      },
    });

  const takeOver = () => {
    if (!targetAccount) return;
    s.open({
      kind: "terminal",
      run: {
        kicker: "Take over",
        title: `${n.project} → ${TOOL_LABEL[targetAccount.tool]} · ${targetAccount.name}`,
        args: takeoverArgs(handle, targetAccount.name, keepCopy && !desktop, n.tool as ProviderId),
      },
    });
  };

  const handOff = async () => {
    if (!handAccount) return;
    try {
      const b = await loadBrief(handAccount.id);
      if (!b.briefPath) throw new Error("the brief file was not written");
      s.open({
        kind: "terminal",
        run: {
          kicker: "Hand off",
          title: `${n.project} → ${TOOL_LABEL[handAccount.tool]} · ${handAccount.name}`,
          args: handoffSeedArgs(handAccount.tool as ProviderId, handAccount.name, b.briefPath),
        },
      });
    } catch (e) {
      s.toast({ text: `Couldn't prepare the handoff brief: ${errorText(e)}`, tone: "alert" });
    }
  };

  const toggleBrief = () => {
    setShowBrief((v) => !v);
    if (!showBrief && handTo && brief?.to !== handTo)
      loadBrief(handTo).catch((e) => s.toast({ text: `Couldn't read the brief: ${errorText(e)}`, tone: "alert" }));
  };

  const showPreview = n.tool === "claude" && !s.hideSummaries && !!s.act.previewSession;

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && s.close()}
      kicker={`${TOOL_LABEL[n.tool]} session`}
      title={`${n.project} · ${n.title}`}
      width={500}
      footer={
        n.trashed ? (
          <Button
            size="sm"
            onClick={() => {
              restoreSessionFrom(s, n);
              s.close();
            }}
          >
            <ArchiveRestore /> Restore
          </Button>
        ) : (
          <>
            <Button
              variant="ghost"
              size="sm"
              disabled={desktop || running || !s.act.trashSession}
              title={
                desktop
                  ? "Started in Claude Desktop — delete it there."
                  : running
                    ? "Stop the session first — a running session can't be moved to the trash"
                    : undefined
              }
              onClick={() =>
                s.open({
                  kind: "confirm",
                  title: `Move ${n.project} to the trash?`,
                  body:
                    n.tool === "codex"
                      ? "Codex archives the session. You can restore it from Trash."
                      : "The transcript moves to the trash. You can restore it from Trash.",
                  confirm: "Move to trash",
                  danger: true,
                  onConfirm: () => trash(s, n),
                })
              }
            >
              <Trash2 /> Move to trash
            </Button>
            {n.tool === "claude" && (
              <Button
                size="sm"
                disabled={desktop || !running}
                title={desktop ? "Started in Claude Desktop — compact it there." : running ? "Runs /compact in this session" : "Only a running session can be compacted"}
                onClick={() => s.open({ kind: "terminal", run: { kicker: "Compact", title: `${n.project} · /compact`, args: compactArgs(profile) } })}
              >
                <Minimize2 /> Compact
              </Button>
            )}
          </>
        )
      }
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-3">
          <SessionStateIcon state={n.state} withLabel />
          <span className="text-xs text-ac-faint">
            {n.state === "working" ? `for ${duration(n.startedAt, s.now)}` : `last active ${ago(n.lastActiveAt, s.now)}`}
          </span>
          {n.livenessUnknown && <Badge>Liveness unknown</Badge>}
          {n.trashed && <Badge tone="warn">In the trash</Badge>}
        </div>
        {n.summary && n.summary !== n.title && !s.hideSummaries && <p className="text-[13px] text-ac-soft">{n.summary}</p>}
        <DefinitionList
          rows={[
            [
              "Runs on",
              account ? (
                <span className="inline-flex items-center gap-2">
                  <AccountDot color={account.color} size={8} />
                  {TOOL_LABEL[account.tool]} · {account.name}
                </span>
              ) : (
                "?"
              ),
            ],
            ["Folder", n.cwd ? <span className="font-ac-mono text-xs">{shortPath(n.cwd)}</span> : "Unknown"],
            ["Branch", n.branch ?? "—"],
            ["Opened in", n.surface === "desktop-app" ? `${TOOL_LABEL[n.tool]} app` : n.surface === "ide" ? "IDE" : n.surface === "terminal" ? "Terminal" : "—"],
            ["Context", n.contextPct == null ? "—" : `${n.contextPct} % of the window${n.model ? ` · ${n.model}` : ""}`],
            ["Created", <span title={new Date(n.startedAt).toLocaleString("en-GB")}>{ago(n.startedAt, s.now)}</span>],
            [
              "Session",
              <span className="font-ac-mono text-xs" title={handle}>
                {handle.slice(0, 8)}
              </span>,
            ],
          ]}
        />
        {showPreview && <Preview s={s} session={n} />}
        {n.protectionNote && (
          <div className="flex items-start gap-2.5 rounded-lg border border-ac-line px-3 py-2.5">
            <ShieldCheck className="mt-px size-4 shrink-0 text-ac-ok" />
            <div className="min-w-0">
              <p className="text-xs text-ac-text">Session protection</p>
              <p className="mt-0.5 text-[11px] text-ac-muted">{n.protectionNote}</p>
            </div>
          </div>
        )}
        <div className="flex flex-col gap-2">
          <Caps>Why this account</Caps>
          <ol className="flex flex-col gap-1.5 border-l border-ac-line2 pl-3">
            {n.why.length ? (
              n.why.map((w, i) => (
                <li key={i} className="text-xs text-ac-soft">
                  {w}
                </li>
              ))
            ) : (
              <li className="text-xs text-ac-faint">No reason recorded for this session.</li>
            )}
          </ol>
        </div>
        {!n.trashed && desktop && (
          <p className="rounded-lg border border-ac-line bg-ac-bg p-4 text-xs text-ac-muted">
            Started in Claude Desktop — it runs on that Desktop window's sign-in, so compact or delete it there. To take it over, quit the Desktop
            window it runs in first.
          </p>
        )}
        {!n.trashed && (
          <div className="flex flex-col gap-3 rounded-lg border border-ac-line bg-ac-bg p-4">
            <div className="flex items-center gap-2">
              <ArrowLeftRight className="size-4 text-ac-brand-text" />
              <span className="text-[13px] font-medium text-ac-text">Move to another account</span>
            </div>
            <p className="text-xs text-ac-muted">A session keeps its account unless you choose here. Nothing happens until you click.</p>
            <Segmented
              label="How"
              fill
              value={how}
              onChange={setHow}
              options={[
                { value: "switch", label: "Switch live", disabled: !live.ok, why: live.reason },
                { value: "takeover", label: "Take over" },
                { value: "handoff", label: "Hand off", disabled: desktop, why: desktop ? "Needs a terminal session's transcript — a Claude Desktop session's isn't reachable here." : undefined },
              ]}
            />
            {how === "switch" && (
              <>
                <p className="text-xs text-ac-muted">{live.reason}</p>
                {options.length ? (
                  <Select label="Switch to" value={target} onChange={setTarget} options={options} />
                ) : (
                  <p className="text-xs text-ac-faint">No other {TOOL_LABEL[n.tool]} account to switch to — add one on Accounts.</p>
                )}
                <div className="flex justify-end">
                  <Button variant="primary" size="sm" disabled={!target || !live.ok || !s.act.rebind} onClick={switchLive}>
                    Switch account
                  </Button>
                </div>
              </>
            )}
            {how === "takeover" && (
              <>
                <p className="text-xs text-ac-muted">
                  {desktop
                    ? "Moves it to that account's Claude Desktop window, where you continue it. Quit the window it runs in first."
                    : `Moves the transcript to another ${TOOL_LABEL[n.tool]} account and resumes it there in a new terminal.`}
                </p>
                {options.length ? (
                  <Select label="Take over on" value={target} onChange={setTarget} options={options} />
                ) : (
                  <p className="text-xs text-ac-faint">No other {TOOL_LABEL[n.tool]} account — add one on Accounts.</p>
                )}
                {!desktop && (
                  <label className="flex items-center justify-between gap-3 text-xs text-ac-soft">
                    <span>
                      Keep a copy on {account?.name}
                      <span className="block text-[11px] text-ac-faint">Fork instead of move — both accounts keep the transcript.</span>
                    </span>
                    <Switch label="Keep a copy" checked={keepCopy} onChange={setKeepCopy} />
                  </label>
                )}
                <div className="flex justify-end">
                  <Button variant="primary" size="sm" disabled={!target} onClick={takeOver}>
                    Take over on {targetAccount?.name ?? "…"}
                  </Button>
                </div>
              </>
            )}
            {how === "handoff" && (
              <>
                <p className="text-xs text-ac-muted">
                  Starts a new session on another provider with a brief of this one. Lossy: only metadata travels — not the transcript, tools or context.
                </p>
                {otherTool.length ? (
                  <Select
                    label="Hand off to"
                    value={handTo}
                    onChange={setHandTo}
                    options={otherTool.map((a) => ({ value: a.id, label: `${TOOL_LABEL[a.tool]} · ${a.name}`, dot: <AccountDot color={a.color} size={8} /> }))}
                  />
                ) : (
                  <p className="text-xs text-ac-faint">No account on another provider yet.</p>
                )}
                <button
                  type="button"
                  onClick={toggleBrief}
                  disabled={!handTo || !s.act.handoffBrief}
                  className="flex items-center gap-2 text-left text-xs text-ac-soft disabled:opacity-45"
                  aria-expanded={showBrief}
                >
                  <ChevronDown className={cn("size-4 transition-transform", showBrief && "rotate-180")} /> {showBrief ? "Hide the brief" : "Show the brief"}
                </button>
                {showBrief && (
                  <div className="flex flex-col gap-2">
                    <pre className="whitespace-pre-wrap rounded-md border border-ac-line bg-ac-panel p-3 font-ac-mono text-[11px] text-ac-soft">
                      {brief?.to === handTo ? brief.brief : "Reading …"}
                    </pre>
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={brief?.to !== handTo}
                        onClick={() => {
                          if (brief) navigator.clipboard?.writeText(brief.brief).catch(() => {});
                          setCopied(true);
                        }}
                      >
                        <Copy /> {copied ? "Copied" : "Copy brief"}
                      </Button>
                    </div>
                  </div>
                )}
                <div className="flex justify-end">
                  <Button variant="primary" size="sm" disabled={!handTo || !s.act.handoffBrief} onClick={() => void handOff()}>
                    Hand off to {handAccount ? `${TOOL_LABEL[handAccount.tool]} · ${handAccount.name}` : "…"}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}
