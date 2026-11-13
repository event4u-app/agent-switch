import { useState } from "react";
import { ArchiveRestore, ArrowLeftRight, ChevronDown, Copy, Eye, Minimize2, ShieldCheck, Trash2 } from "lucide-react";
import { en } from "../../i18n/en/index.js";
import { getLang, locale, t } from "../../i18n/index.js";
import { compactArgs, handoffSeedArgs, takeoverArgs } from "../../ipc.js";
import { formatCacheLine, type ProviderId } from "../../transforms.js";
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
import { armSwitch, isRunning, liveSwitch, sessionHandle, switchTargets } from "./logic.js";

/** The arm dialog's copy (D3). Both sentences are load-bearing: the cache does
 *  not travel, and nothing switches unless the user confirms here. */
export const ARM_CACHE_SENTENCE = en["sessions.sheet.armCache"];
export const ARM_CLICK_SENTENCE = en["sessions.sheet.armClick"];

/** The slash command a compaction runs — a command, never translated. */
const COMPACT_COMMAND = "/compact";

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
    .catch((e) => s.toast({ text: t("sessions.sheet.restoreFailed", { error: errorText(e) }), tone: "alert" }));
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
        text: t("sessions.sheet.trashed", { project: session.project }),
        action: canUndo ? { label: t("sessions.sheet.undo"), run: () => restoreSessionFrom(s, { ...session, trashed: true }) } : undefined,
      });
    })
    .catch((e) => s.toast({ text: t("sessions.sheet.trashFailed", { project: session.project, error: errorText(e) }), tone: "alert" }));
}

/** Options for a same-tool target account. For a live switch an account with
 *  a session of its own stays listed but disabled: the switch would move its
 *  login away and sign that session out, so the CLI refuses it. */
export function targetOptions(ranked: readonly RankedAccount[], opts: { liveSwitch?: boolean } = {}): SelectOption[] {
  return ranked.map((r) => {
    const max = maxUtilization(r.account.windows);
    const busy = !!opts.liveSwitch && r.account.liveSessions > 0;
    return {
      value: r.account.id,
      label: `${TOOL_LABEL[r.account.tool]} · ${r.account.name}`,
      hint: busy
        ? t("sessions.sheet.busyTarget")
        : max != null
          ? t(r.rank === 1 ? "sessions.sheet.usedMost" : "sessions.sheet.used", { pct: max })
          : t("sessions.sheet.usageNa"),
      dot: <AccountDot color={r.account.color} size={8} />,
      disabled: busy || undefined,
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
        <Caps>{t("sessions.sheet.preview")}</Caps>
        <ChevronDown className={cn("ml-auto size-4 text-ac-muted transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="flex flex-col gap-2 rounded-lg border border-ac-line bg-ac-bg p-3">
          {turns == null ? (
            <p className="text-xs text-ac-muted">{t("sessions.sheet.reading")}</p>
          ) : turns.length ? (
            turns.map((turn, i) => (
              <p key={i} className="text-xs">
                <span className={cn("mr-2 font-ac-mono text-[10px] uppercase tracking-wider", turn.role === "you" ? "text-ac-brand-text" : "text-ac-info-text")}>
                  {turn.role === "you" ? t("sessions.sheet.you") : t("sessions.sheet.agent")}
                </span>
                <span className="text-ac-soft">{turn.text}</span>
              </p>
            ))
          ) : (
            <p className="text-xs text-ac-muted">{t("sessions.sheet.noTurns")}</p>
          )}
          <p className="text-[11px] text-ac-faint">{t("sessions.sheet.previewNote")}</p>
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
      ? { ok: false, reason: t("sessions.sheet.desktopKeeps") }
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
  // A live switch never lands on a busy account: the remembered pick when it is
  // free, else the best-ranked free one.
  const switchOptions = targetOptions(sameTool, { liveSwitch: true });
  const freeTargets = switchTargets(sameTool);
  const switchTo = freeTargets.some((r) => r.account.id === target)
    ? target
    : (freeTargets.find((r) => r.rank != null)?.account.id ?? freeTargets[0]?.account.id ?? "");
  const switchAccount = s.accountById(switchTo);
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
      title: t("sessions.sheet.switchTitle", { project: n.project, name: switchAccount?.name ?? "" }),
      body: t("sessions.sheet.switchBody"),
      confirm: t("sessions.sheet.switchAccount"),
      onConfirm: () => {
        s.act
          .rebind?.(n.id, switchTo)
          .then(() => s.toast({ text: t("sessions.sheet.nowRunsOn", { project: n.project, name: switchAccount?.name ?? "" }), tone: "ok" }))
          .catch((e) =>
            s.toast({ text: t("sessions.sheet.switchFailed", { project: n.project, name: account?.name ?? "", error: errorText(e) }), tone: "alert" }),
          );
      },
    });

  const arm = n.surface === "desktop-app" ? { ok: false, reason: live.reason } : armSwitch(n, s.platform);
  const armedTo = n.armedSwitch ? s.accountById(n.armedSwitch.target) : undefined;

  const armLive = () =>
    s.open({
      kind: "confirm",
      title: t("sessions.sheet.armTitle", { project: n.project, name: switchAccount?.name ?? "" }),
      body: `${t("sessions.sheet.armCache")} ${t("sessions.sheet.armClick")} ${t("sessions.sheet.armRest")}`,
      confirm: t("sessions.sheet.armConfirm"),
      onConfirm: () => {
        s.act
          .armRebind?.(n.id, switchTo)
          .then(() => s.toast({ text: t("sessions.sheet.armed", { project: n.project, name: switchAccount?.name ?? "" }), tone: "ok" }))
          .catch((e) =>
            s.toast({ text: t("sessions.sheet.armFailed", { project: n.project, name: account?.name ?? "", error: errorText(e) }), tone: "alert" }),
          );
      },
    });

  const cancelArmed = () =>
    s.act
      .cancelArm?.(n.id)
      .then(() => s.toast({ text: t("sessions.sheet.staysOn", { project: n.project, name: account?.name ?? "" }), tone: "ok" }))
      .catch((e) => s.toast({ text: t("sessions.sheet.cancelArmFailed", { error: errorText(e) }), tone: "alert" }));

  const takeOver = () => {
    if (!targetAccount) return;
    s.open({
      kind: "terminal",
      run: {
        kicker: t("sessions.sheet.takeOver"),
        title: `${n.project} → ${TOOL_LABEL[targetAccount.tool]} · ${targetAccount.name}`,
        args: takeoverArgs(handle, targetAccount.name, keepCopy && !desktop, n.tool as ProviderId),
      },
    });
  };

  const handOff = async () => {
    if (!handAccount) return;
    try {
      const b = await loadBrief(handAccount.id);
      if (!b.briefPath) throw new Error(t("sessions.sheet.briefNotWritten"));
      s.open({
        kind: "terminal",
        run: {
          kicker: t("sessions.sheet.handOff"),
          title: `${n.project} → ${TOOL_LABEL[handAccount.tool]} · ${handAccount.name}`,
          args: handoffSeedArgs(handAccount.tool as ProviderId, handAccount.name, b.briefPath),
        },
      });
    } catch (e) {
      s.toast({ text: t("sessions.sheet.handoffFailed", { error: errorText(e) }), tone: "alert" });
    }
  };

  const toggleBrief = () => {
    setShowBrief((v) => !v);
    if (!showBrief && handTo && brief?.to !== handTo)
      loadBrief(handTo).catch((e) => s.toast({ text: t("sessions.sheet.briefFailed", { error: errorText(e) }), tone: "alert" }));
  };

  const showPreview = n.tool === "claude" && !s.hideSummaries && !!s.act.previewSession;

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && s.close()}
      kicker={t("sessions.sheet.kicker", { tool: TOOL_LABEL[n.tool] })}
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
            <ArchiveRestore /> {t("sessions.sheet.restore")}
          </Button>
        ) : (
          <>
            <Button
              variant="ghost"
              size="sm"
              disabled={desktop || running || !s.act.trashSession}
              title={
                desktop ? t("sessions.sheet.desktopDelete") : running ? t("sessions.sheet.stopFirst") : undefined
              }
              onClick={() =>
                s.open({
                  kind: "confirm",
                  title: t("sessions.sheet.trashTitle", { project: n.project }),
                  body: n.tool === "codex" ? t("sessions.sheet.trashCodex") : t("sessions.sheet.trashClaude"),
                  confirm: t("sessions.sheet.moveToTrash"),
                  danger: true,
                  onConfirm: () => trash(s, n),
                })
              }
            >
              <Trash2 /> {t("sessions.sheet.moveToTrash")}
            </Button>
            {n.tool === "claude" && (
              <Button
                size="sm"
                disabled={desktop || !running}
                title={
                  desktop
                    ? t("sessions.sheet.desktopCompact")
                    : running
                      ? t("sessions.sheet.compactHint")
                      : t("sessions.sheet.compactRunning")
                }
                onClick={() => s.open({ kind: "terminal", run: { kicker: t("sessions.sheet.compact"), title: `${n.project} · ${COMPACT_COMMAND}`, args: compactArgs(profile) } })}
              >
                <Minimize2 /> {t("sessions.sheet.compact")}
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
            {n.state === "working"
              ? t("sessions.sheet.for", { duration: duration(n.startedAt, s.now) })
              : t("sessions.sheet.lastActive", { ago: ago(n.lastActiveAt, s.now) })}
          </span>
          {n.livenessUnknown && <Badge>{t("sessions.sheet.livenessUnknown")}</Badge>}
          {n.trashed && <Badge tone="warn">{t("sessions.sheet.inTrash")}</Badge>}
        </div>
        {n.summary && n.summary !== n.title && !s.hideSummaries && <p className="text-[13px] text-ac-soft">{n.summary}</p>}
        <DefinitionList
          rows={[
            [
              t("sessions.sheet.runsOn"),
              account ? (
                <span className="inline-flex items-center gap-2">
                  <AccountDot color={account.color} size={8} />
                  {TOOL_LABEL[account.tool]} · {account.name}
                </span>
              ) : (
                "?"
              ),
            ],
            [t("sessions.sheet.folder"), n.cwd ? <span className="font-ac-mono text-xs">{shortPath(n.cwd)}</span> : t("sessions.sheet.unknown")],
            [t("sessions.sheet.branch"), n.branch ?? "—"],
            [
              t("sessions.sheet.openedIn"),
              n.surface === "desktop-app"
                ? t("sessions.sheet.app", { tool: TOOL_LABEL[n.tool] })
                : n.surface === "ide"
                  ? t("sessions.sheet.ide")
                  : n.surface === "terminal"
                    ? t("sessions.sheet.terminal")
                    : "—",
            ],
            [
              t("sessions.sheet.context"),
              n.contextPct == null ? "—" : `${t("sessions.sheet.contextPct", { pct: n.contextPct })}${n.model ? ` · ${n.model}` : ""}`,
            ],
            [t("sessions.sheet.cache"), formatCacheLine(n.cache) || "—"],
            [
              t("sessions.sheet.created"),
              <span title={new Date(n.startedAt).toLocaleString(getLang() === "en" ? "en-GB" : locale())}>{ago(n.startedAt, s.now)}</span>,
            ],
            [
              t("sessions.sheet.session"),
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
              <p className="text-xs text-ac-text">{t("sessions.sheet.protection")}</p>
              <p className="mt-0.5 text-[11px] text-ac-muted">{n.protectionNote}</p>
            </div>
          </div>
        )}
        <div className="flex flex-col gap-2">
          <Caps>{t("sessions.sheet.why")}</Caps>
          <ol className="flex flex-col gap-1.5 border-l border-ac-line2 pl-3">
            {n.why.length ? (
              n.why.map((w, i) => (
                <li key={i} className="text-xs text-ac-soft">
                  {w}
                </li>
              ))
            ) : (
              <li className="text-xs text-ac-faint">{t("sessions.sheet.noReason")}</li>
            )}
          </ol>
        </div>
        {!n.trashed && desktop && (
          <p className="rounded-lg border border-ac-line bg-ac-bg p-4 text-xs text-ac-muted">
            {t("sessions.sheet.desktopNote")}
          </p>
        )}
        {!n.trashed && (
          <div className="flex flex-col gap-3 rounded-lg border border-ac-line bg-ac-bg p-4">
            <div className="flex items-center gap-2">
              <ArrowLeftRight className="size-4 text-ac-brand-text" />
              <span className="text-[13px] font-medium text-ac-text">{t("sessions.sheet.move")}</span>
            </div>
            <p className="text-xs text-ac-muted">{t("sessions.sheet.moveNote")}</p>
            {how !== "handoff" && (
              <p className="text-[11px] text-ac-faint">{t("sessions.sheet.cacheNote")}</p>
            )}
            <Segmented
              label={t("sessions.sheet.how")}
              fill
              value={how}
              onChange={setHow}
              options={[
                { value: "switch", label: t("sessions.sheet.switchLive"), disabled: !live.ok, why: live.reason },
                { value: "takeover", label: t("sessions.sheet.takeOver") },
                { value: "handoff", label: t("sessions.sheet.handOff"), disabled: desktop, why: desktop ? t("sessions.sheet.handoffDesktop") : undefined },
              ]}
            />
            {how === "switch" && (
              <>
                <p className="text-xs text-ac-muted">{live.reason}</p>
                {options.length ? (
                  <Select label={t("sessions.sheet.switchTo")} value={switchTo} onChange={setTarget} options={switchOptions} />
                ) : (
                  <p className="text-xs text-ac-faint">{t("sessions.sheet.noSwitchTarget", { tool: TOOL_LABEL[n.tool] })}</p>
                )}
                {n.armedSwitch ? (
                  <div className="flex items-center justify-between gap-3 rounded-md border border-ac-line px-3 py-2">
                    <p className="text-xs text-ac-soft">{t("sessions.sheet.armedTo", { name: armedTo?.name ?? t("sessions.sheet.anotherAccount") })}</p>
                    <Button size="sm" variant="ghost" disabled={!s.act.cancelArm} onClick={() => void cancelArmed()}>
                      {t("sessions.sheet.cancelSwitch")}
                    </Button>
                  </div>
                ) : null}
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    disabled={!switchTo || !arm.ok || !s.act.armRebind}
                    title={arm.reason}
                    onClick={armLive}
                  >
                    {t("sessions.sheet.whenTurnEnds")}
                  </Button>
                  <Button variant="primary" size="sm" disabled={!switchTo || !live.ok || !s.act.rebind} onClick={switchLive}>
                    {t("sessions.sheet.switchAccount")}
                  </Button>
                </div>
              </>
            )}
            {how === "takeover" && (
              <>
                <p className="text-xs text-ac-muted">
                  {desktop
                    ? t("sessions.sheet.takeoverDesktop")
                    : t("sessions.sheet.takeoverTerminal", { tool: TOOL_LABEL[n.tool] })}
                </p>
                {options.length ? (
                  <Select label={t("sessions.sheet.takeOverOn")} value={target} onChange={setTarget} options={options} />
                ) : (
                  <p className="text-xs text-ac-faint">{t("sessions.sheet.noOther", { tool: TOOL_LABEL[n.tool] })}</p>
                )}
                {!desktop && (
                  <label className="flex items-center justify-between gap-3 text-xs text-ac-soft">
                    <span>
                      {t("sessions.sheet.keepCopyOn", { name: account?.name ?? "" })}
                      <span className="block text-[11px] text-ac-faint">{t("sessions.sheet.forkNote")}</span>
                    </span>
                    <Switch label={t("sessions.sheet.keepCopy")} checked={keepCopy} onChange={setKeepCopy} />
                  </label>
                )}
                <div className="flex justify-end">
                  <Button variant="primary" size="sm" disabled={!target} onClick={takeOver}>
                    {t("sessions.sheet.takeOverOnName", { name: targetAccount?.name ?? "…" })}
                  </Button>
                </div>
              </>
            )}
            {how === "handoff" && (
              <>
                <p className="text-xs text-ac-muted">{t("sessions.sheet.handoffNote")}</p>
                {otherTool.length ? (
                  <Select
                    label={t("sessions.sheet.handOffTo")}
                    value={handTo}
                    onChange={setHandTo}
                    options={otherTool.map((a) => ({ value: a.id, label: `${TOOL_LABEL[a.tool]} · ${a.name}`, dot: <AccountDot color={a.color} size={8} /> }))}
                  />
                ) : (
                  <p className="text-xs text-ac-faint">{t("sessions.sheet.noOtherProvider")}</p>
                )}
                <button
                  type="button"
                  onClick={toggleBrief}
                  disabled={!handTo || !s.act.handoffBrief}
                  className="flex items-center gap-2 text-left text-xs text-ac-soft disabled:opacity-45"
                  aria-expanded={showBrief}
                >
                  <ChevronDown className={cn("size-4 transition-transform", showBrief && "rotate-180")} /> {showBrief ? t("sessions.sheet.hideBrief") : t("sessions.sheet.showBrief")}
                </button>
                {showBrief && (
                  <div className="flex flex-col gap-2">
                    <pre className="whitespace-pre-wrap rounded-md border border-ac-line bg-ac-panel p-3 font-ac-mono text-[11px] text-ac-soft">
                      {brief?.to === handTo ? brief.brief : t("sessions.sheet.reading")}
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
                        <Copy /> {copied ? t("common.copied") : t("sessions.sheet.copyBrief")}
                      </Button>
                    </div>
                  </div>
                )}
                <div className="flex justify-end">
                  <Button variant="primary" size="sm" disabled={!handTo || !s.act.handoffBrief} onClick={() => void handOff()}>
                    {t("sessions.sheet.handOffToName", { name: handAccount ? `${TOOL_LABEL[handAccount.tool]} · ${handAccount.name}` : "…" })}
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
