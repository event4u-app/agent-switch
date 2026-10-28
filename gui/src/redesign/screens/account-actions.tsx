import { AppWindow, ExternalLink, Gauge, LogIn, Pencil, Power, RotateCcw, SquareTerminal, Star, Trash2 } from "lucide-react";
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

/** "Turn off — plain starts use your original login". Bundle `f0`. */
export function turnOffPlainStarts(a: Account, s: Store) {
  if (a.tool !== "gemini") attempt(s, s.act.deactivate?.(a.tool), "Couldn't turn it off");
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

/** Row ⋯ menu. Bundle `dP`. */
export function accountMenu(a: Account, s: Store): RowMenuItem[] {
  const out = a.state === "signed-out" || a.state === "wrong-account";
  const app = appFor(s, a.tool);
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
      ? { id: "off", label: "Turn off — plain starts use your original login", icon: <Power />, onSelect: () => turnOffPlainStarts(a, s) }
      : { id: "default", label: "Use for plain starts", icon: <Star />, disabled: out, onSelect: () => makeDefault(a, s) },
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
    { id: "details", label: "Usage, protection, tag …", icon: <Gauge />, separatorBefore: true, onSelect: () => s.open({ kind: "account", id: a.id }) },
    { id: "signin", label: a.identity ? "Sign in again" : "Sign in", icon: <LogIn />, onSelect: () => s.open({ kind: "reauth", accountId: a.id }) },
    { id: "rename", label: "Rename, recolour, tag", icon: <Pencil />, onSelect: () => s.open({ kind: "account", id: a.id }) },
    { id: "remove", label: "Remove account …", icon: <Trash2 />, danger: true, separatorBefore: true, onSelect: () => confirmRemove(a, s) },
  ];
}
