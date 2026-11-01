import { AppWindow, CirclePause, CirclePlay, ExternalLink, Gauge, LogIn, Pencil, RefreshCw, RotateCcw, SquareTerminal, Star, Trash2 } from "lucide-react";
import { t, tp } from "../../i18n/index.js";
import { hasUsageReadout } from "../../transforms.js";
import type { RowMenuItem } from "../../ui/RowMenu.js";
import { TOOL_LABEL } from "../../vm/rules.js";
import type { Store } from "../../vm/store.js";
import type { Account } from "../../vm/types.js";
import { appFor } from "./logic.js";

/**
 * Account actions shared by the Accounts list, the account sheet and Usage
 * history (bundle `d0`, `Ki`, `f0`, `p0`, `h0`, `dP`). Optimistic like the
 * design; a failed call raises an alert toast and the reload restores truth.
 */

/** Runs a backend call and turns a failure into an alert toast. */
export function attempt(s: Pick<Store, "toast">, p: Promise<unknown> | undefined, failed: string): void {
  void p?.catch((e: unknown) => s.toast({ tone: "alert", text: `${failed}: ${e instanceof Error ? e.message : String(e)}` }));
}

// --------------------------------------------------------- account actions

/** Bundle `d0`. */
export function startAs(a: Account, s: Store) {
  s.open({ kind: "start", tool: a.tool, accountId: a.id });
}

/** "Use for plain starts". Bundle `Ki`. */
export function makeDefault(a: Account, s: Store) {
  attempt(s, s.act.setDefault?.(a.id), t("accounts.actions.useFailed", { name: a.name }));
  s.update((vm) => ({ accounts: vm.accounts.map((o) => (o.tool === a.tool ? { ...o, isDefault: o.id === a.id } : o)) }));
}

/** Filled while the account is the one plain starts use. */
export function PlainStartStar({ on }: { on: boolean }) {
  return <Star className={on ? "text-ac-brand" : undefined} fill={on ? "currentColor" : "none"} />;
}

/** Back to the original login for plain starts. Bundle `f0`. */
export function turnOffPlainStarts(a: Account, s: Store) {
  if (a.tool !== "gemini") attempt(s, s.act.deactivate?.(a.tool), t("accounts.actions.stopUsingFailed", { name: a.name }));
  s.update((vm) => ({ accounts: vm.accounts.map((o) => (o.id === a.id ? { ...o, isDefault: false } : o)) }));
}

/** Bundle `p0`. `removeAccount` passes --force: an active account is deactivated first. */
export function confirmRemove(a: Account, s: Store) {
  s.open({
    kind: "confirm",
    title: t("accounts.actions.removeTitle", { tool: TOOL_LABEL[a.tool], name: a.name }),
    body: t("accounts.actions.removeBody"),
    confirm: t("accounts.actions.removeConfirm"),
    danger: true,
    onConfirm: () => {
      attempt(s, s.act.removeAccount?.(a.id), t("accounts.actions.removeFailed", { name: a.name }));
      s.update((vm) => ({ accounts: vm.accounts.filter((o) => o.id !== a.id) }));
    },
  });
}

/** Bundle `h0`. */
export function confirmRedeem(a: Account, s: Store) {
  s.open({
    kind: "confirm",
    title: t("accounts.actions.redeemTitle"),
    body: tp("accounts.actions.redeemBody", a.resetCredits ?? 0, { name: a.name }),
    confirm: t("accounts.actions.redeemOne"),
    onConfirm: () => attempt(s, s.act.redeemReset?.(a.id), t("accounts.actions.redeemFailed")),
  });
}

/** Disable keeps the account (sign-in, history, settings) but takes it out of
 *  every pick; disabling the account for plain starts also clears that slot. */
export function setDisabled(a: Account, s: Store, disabled: boolean) {
  attempt(s, s.act.setAccountDisabled?.(a.id, disabled), disabled ? t("accounts.actions.disableFailed", { name: a.name }) : t("accounts.actions.enableFailed", { name: a.name }));
  s.update((vm) => ({ accounts: vm.accounts.map((o) => (o.id === a.id ? { ...o, disabled, isDefault: disabled ? false : o.isDefault } : o)) }));
  s.toast({ text: disabled ? t("accounts.actions.disabledToast", { name: a.name }) : t("accounts.actions.enabledToast", { name: a.name }) });
}

/** Fetches one account's usage now; the result shows on the row itself. */
export function refreshOne(a: Account, s: Store): Promise<void> {
  return (s.act.refreshAccountUsage?.(a.id) ?? Promise.resolve())
    .then(() => s.toast({ text: t("accounts.actions.refreshed", { name: a.name }) }))
    .catch((e: unknown) => s.toast({ tone: "alert", text: t("accounts.actions.refreshFailed", { name: a.name, error: e instanceof Error ? e.message : String(e) }) }));
}

/** Row ⋯ menu. Bundle `dP`. */
export function accountMenu(a: Account, s: Store): RowMenuItem[] {
  const out = a.state === "signed-out" || a.state === "wrong-account" || !!a.disabled;
  const app = appFor(s, a.tool);
  const readout = a.tool !== "gemini" && hasUsageReadout(a.tool);
  return [
    { id: "term", label: t("accounts.action.startAs"), icon: <SquareTerminal />, disabled: out, onSelect: () => startAs(a, s) },
    ...(app
      ? [
          {
            id: "app",
            label: t("accounts.actions.openAppAs", { tool: TOOL_LABEL[a.tool] }),
            icon: <AppWindow />,
            disabled: out,
            onSelect: () => attempt(s, s.act.openApp?.(app, a.id), t("accounts.actions.openAppFailed")),
          },
        ]
      : []),
    a.isDefault
      ? { id: "off", label: t("accounts.action.usePlain"), icon: <PlainStartStar on />, hint: t("accounts.actions.hintOn"), onSelect: () => turnOffPlainStarts(a, s) }
      : { id: "default", label: t("accounts.action.usePlain"), icon: <PlainStartStar on={false} />, disabled: out, onSelect: () => makeDefault(a, s) },
    a.tool === "claude"
      ? {
          id: "reset",
          label: t("accounts.actions.checkFreeReset"),
          icon: <ExternalLink />,
          hint: t("accounts.actions.claudeUsagePath"),
          disabled: !s.act.openUsagePage,
          onSelect: () => attempt(s, s.act.openUsagePage?.(a.id), t("accounts.actions.openClaudeFailed")),
        }
      : {
          id: "reset",
          label: t("accounts.actions.redeemCredit"),
          icon: <RotateCcw />,
          hint: a.resetCredits != null ? t("accounts.actions.creditsLeft", { count: a.resetCredits }) : undefined,
          disabled: !a.resetCredits,
          onSelect: () => confirmRedeem(a, s),
        },
    ...(readout
      ? [
          {
            id: "refresh",
            label: t("accounts.action.refreshUsage"),
            icon: <RefreshCw />,
            separatorBefore: true,
            // By hand only: a disabled account still refreshes from here.
            disabled: (out && !a.disabled) || a.state === "signed-out" || !s.act.refreshAccountUsage,
            hint: a.state === "signed-out" || (out && !a.disabled) ? t("accounts.actions.signInFirstHint") : undefined,
            onSelect: () => refreshOne(a, s),
          },
        ]
      : []),
    { id: "details", label: t("accounts.actions.details"), icon: <Gauge />, separatorBefore: !readout, onSelect: () => s.open({ kind: "account", id: a.id, section: "usage" }) },
    { id: "signin", label: a.identity ? t("accounts.action.signInAgain") : t("accounts.action.signIn"), icon: <LogIn />, onSelect: () => s.open({ kind: "reauth", accountId: a.id }) },
    { id: "rename", label: t("accounts.actions.rename"), icon: <Pencil />, onSelect: () => s.open({ kind: "account", id: a.id, section: "edit" }) },
    a.disabled
      ? { id: "enable", label: t("accounts.actions.turnBackOn"), icon: <CirclePlay />, separatorBefore: true, disabled: !s.act.setAccountDisabled, onSelect: () => setDisabled(a, s, false) }
      : {
          id: "disable",
          label: t("accounts.actions.disable"),
          icon: <CirclePause />,
          separatorBefore: true,
          disabled: !s.act.setAccountDisabled,
          onSelect: () => setDisabled(a, s, true),
        },
    { id: "remove", label: t("accounts.actions.removeMenu"), icon: <Trash2 />, danger: true, onSelect: () => confirmRemove(a, s) },
  ];
}
