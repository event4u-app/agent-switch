import { AppWindow, CirclePause, CirclePlay, ExternalLink, Gauge, LogIn, Pencil, RefreshCw, RotateCcw, SquareTerminal, Star, Trash2 } from "lucide-react";
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
  attempt(s, s.act.setDefault?.(a.id), `Couldn't use ${a.name} for plain starts`);
  s.update((vm) => ({ accounts: vm.accounts.map((o) => (o.tool === a.tool ? { ...o, isDefault: o.id === a.id } : o)) }));
}

/** Filled while the account is the one plain starts use. */
export function PlainStartStar({ on }: { on: boolean }) {
  return <Star className={on ? "text-ac-brand" : undefined} fill={on ? "currentColor" : "none"} />;
}

/** Back to the original login for plain starts. Bundle `f0`. */
export function turnOffPlainStarts(a: Account, s: Store) {
  if (a.tool !== "gemini") attempt(s, s.act.deactivate?.(a.tool), `Couldn't stop using ${a.name} for plain starts`);
  s.update((vm) => ({ accounts: vm.accounts.map((o) => (o.id === a.id ? { ...o, isDefault: false } : o)) }));
}

/** Bundle `p0`. `removeAccount` passes --force: an active account is deactivated first. */
export function confirmRemove(a: Account, s: Store) {
  s.open({
    kind: "confirm",
    title: `Remove ${TOOL_LABEL[a.tool]} · ${a.name}?`,
    body: "Removes this account's folder and sign-in from Agent Switch. Its sessions stay on disk; your original login is untouched. This cannot be undone.",
    confirm: "Remove account",
    danger: true,
    onConfirm: () => {
      attempt(s, s.act.removeAccount?.(a.id), `Couldn't remove ${a.name}`);
      s.update((vm) => ({ accounts: vm.accounts.filter((o) => o.id !== a.id) }));
    },
  });
}

/** Bundle `h0`. */
export function confirmRedeem(a: Account, s: Store) {
  s.open({
    kind: "confirm",
    title: "Redeem a reset credit?",
    body: `Resets ${a.name}'s usage window now. ${a.resetCredits ?? 0} credit${a.resetCredits === 1 ? "" : "s"} left before this one. Credits can't be given back.`,
    confirm: "Redeem one",
    onConfirm: () => attempt(s, s.act.redeemReset?.(a.id), "Couldn't redeem the credit"),
  });
}

/** Disable keeps the account (sign-in, history, settings) but takes it out of
 *  every pick; disabling the account for plain starts also clears that slot. */
export function setDisabled(a: Account, s: Store, disabled: boolean) {
  attempt(s, s.act.setAccountDisabled?.(a.id, disabled), disabled ? `Couldn't disable ${a.name}` : `Couldn't turn ${a.name} back on`);
  s.update((vm) => ({ accounts: vm.accounts.map((o) => (o.id === a.id ? { ...o, disabled, isDefault: disabled ? false : o.isDefault } : o)) }));
  s.toast({ text: disabled ? `${a.name} is disabled — nothing was deleted.` : `${a.name} is back on.` });
}

/** Fetches one account's usage now; the result shows on the row itself. */
export function refreshOne(a: Account, s: Store): Promise<void> {
  return (s.act.refreshAccountUsage?.(a.id) ?? Promise.resolve())
    .then(() => s.toast({ text: `${a.name}: usage refreshed.` }))
    .catch((e: unknown) => s.toast({ tone: "alert", text: `Couldn't refresh ${a.name}: ${e instanceof Error ? e.message : String(e)}` }));
}

/** Row ⋯ menu. Bundle `dP`. */
export function accountMenu(a: Account, s: Store): RowMenuItem[] {
  const out = a.state === "signed-out" || a.state === "wrong-account" || !!a.disabled;
  const app = appFor(s, a.tool);
  const readout = a.tool !== "gemini" && hasUsageReadout(a.tool);
  return [
    { id: "term", label: "Start session as this account", icon: <SquareTerminal />, disabled: out, onSelect: () => startAs(a, s) },
    ...(app
      ? [
          {
            id: "app",
            label: `Open ${TOOL_LABEL[a.tool]} app as this account`,
            icon: <AppWindow />,
            disabled: out,
            onSelect: () => attempt(s, s.act.openApp?.(app, a.id), "Couldn't open the app"),
          },
        ]
      : []),
    a.isDefault
      ? { id: "off", label: "Use for plain starts", icon: <PlainStartStar on />, hint: "on", onSelect: () => turnOffPlainStarts(a, s) }
      : { id: "default", label: "Use for plain starts", icon: <PlainStartStar on={false} />, disabled: out, onSelect: () => makeDefault(a, s) },
    a.tool === "claude"
      ? {
          id: "reset",
          label: "Check for a free reset at Claude",
          icon: <ExternalLink />,
          hint: "Settings › Usage",
          disabled: !s.act.openUsagePage,
          onSelect: () => attempt(s, s.act.openUsagePage?.(a.id), "Couldn't open Claude"),
        }
      : {
          id: "reset",
          label: "Redeem a reset credit",
          icon: <RotateCcw />,
          hint: a.resetCredits != null ? `${a.resetCredits} left` : undefined,
          disabled: !a.resetCredits,
          onSelect: () => confirmRedeem(a, s),
        },
    ...(readout
      ? [
          {
            id: "refresh",
            label: "Refresh usage",
            icon: <RefreshCw />,
            separatorBefore: true,
            // By hand only: a disabled account still refreshes from here.
            disabled: (out && !a.disabled) || a.state === "signed-out" || !s.act.refreshAccountUsage,
            hint: a.state === "signed-out" || (out && !a.disabled) ? "sign in first" : undefined,
            onSelect: () => refreshOne(a, s),
          },
        ]
      : []),
    { id: "details", label: "Usage, protection, tag …", icon: <Gauge />, separatorBefore: !readout, onSelect: () => s.open({ kind: "account", id: a.id, section: "usage" }) },
    { id: "signin", label: a.identity ? "Sign in again" : "Sign in", icon: <LogIn />, onSelect: () => s.open({ kind: "reauth", accountId: a.id }) },
    { id: "rename", label: "Rename, recolour, tag", icon: <Pencil />, onSelect: () => s.open({ kind: "account", id: a.id, section: "edit" }) },
    a.disabled
      ? { id: "enable", label: "Turn back on", icon: <CirclePlay />, separatorBefore: true, disabled: !s.act.setAccountDisabled, onSelect: () => setDisabled(a, s, false) }
      : {
          id: "disable",
          label: "Disable account — keep it, stop using it",
          icon: <CirclePause />,
          separatorBefore: true,
          disabled: !s.act.setAccountDisabled,
          onSelect: () => setDisabled(a, s, true),
        },
    { id: "remove", label: "Remove account …", icon: <Trash2 />, danger: true, onSelect: () => confirmRemove(a, s) },
  ];
}
