import { CircleCheck, EyeOff, Info, MoreHorizontal, Rocket, SlidersHorizontal } from "lucide-react";
import { Button, IconButton } from "../../ui/Button.js";
import { Card, EmptyState } from "../../ui/Card.js";
import { AccountDot } from "../../ui/AccountDot.js";
import { RowMenu } from "../../ui/RowMenu.js";
import { Switch } from "../../ui/Switch.js";
import { SectionHeader } from "../../ui/Typography.js";
import { ago } from "../../ui/format.js";
import { TOOL_LABEL } from "../../vm/rules.js";
import { useAS, type Store } from "../../vm/store.js";
import type { Account, Surface, Tool } from "../../vm/types.js";
import { hasLauncher } from "./logic.js";

/** Design `aP`. */
export const APP_TOOLS: Tool[] = ["claude", "codex", "gemini", "antigravity"];

/** "Found 2 of 3: Claude Desktop, Codex." */
export function foundLine(surfaces: readonly Surface[]): string {
  const found = surfaces.filter((x) => x.detected);
  return `Found ${found.length} of ${surfaces.length}: ${found.map((x) => x.name).join(", ")}.`;
}

/** Secondary line of an app row (design `iP`); the age only when one was read. */
export function surfaceSub(o: Surface, now: number): string {
  const what = o.note ?? (o.identitySeen === "per session" ? "Account chosen per session" : o.identitySeen ? `Running as ${o.identitySeen}` : o.kind.toUpperCase());
  return o.checkedAt != null ? `${what} · checked ${ago(o.checkedAt, now)}` : what;
}

function failed(s: Store, what: string) {
  return (e: unknown) => s.toast({ tone: "alert", text: `${what}: ${e instanceof Error ? e.message : String(e)}` });
}

/** One account of one app: open it, its launcher (macOS), copy settings into it. */
function AppAccountRow({ app, account: a, accounts }: { app: Surface; account: Account; accounts: Account[] }) {
  const s = useAS();
  const mac = s.platform === "mac";
  const on = hasLauncher(s.launchers, app.id, a.id);
  const who = `${TOOL_LABEL[a.tool]} · ${a.name}`;
  const copyFrom = (from: string, label: string) =>
    s.open({
      kind: "confirm",
      title: `Copy ${app.name} settings into ${a.name}?`,
      body: `Takes the MCP servers, preferences and extensions of ${label}. Logins, chats and account-bound preferences are not copied; the files it replaces are kept as a backup. Quit ${app.name} on ${a.name} first.`,
      confirm: "Copy settings",
      onConfirm: () => {
        s.act.copyAppSettings?.(app.id, from, a.id).then(
          () => s.toast({ tone: "ok", text: `${app.name} settings copied into ${a.name}.` }),
          failed(s, "Couldn't copy the settings"),
        );
      },
    });
  const menu = [
    ...(s.act.openApp ? [{ id: "open", label: `Open as ${who}`, icon: <AccountDot color={a.color} size={8} />, onSelect: () => s.act.openApp?.(app.id, a.id).catch(failed(s, `Couldn't open ${app.name}`)) }] : []),
    ...(app.copiesSettings && s.act.copyAppSettings
      ? [
          { id: "copy:default", label: `Copy settings from the default ${app.name}`, icon: <SlidersHorizontal />, onSelect: () => copyFrom("default", `the default ${app.name}`) },
          ...accounts
            .filter((x) => x.id !== a.id)
            .map((x) => ({ id: `copy:${x.id}`, label: `Copy settings from ${TOOL_LABEL[x.tool]} · ${x.name}`, icon: <SlidersHorizontal />, onSelect: () => copyFrom(x.id, x.name) })),
        ]
      : []),
  ];
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <AccountDot color={a.color} size={8} />
      <span className="min-w-0 flex-1 truncate text-[13px] text-ac-text">{a.name}</span>
      {app.detected && s.act.openApp && (
        <Button size="sm" variant="ghost" onClick={() => s.act.openApp?.(app.id, a.id).catch(failed(s, `Couldn't open ${app.name}`))}>
          Open
        </Button>
      )}
      {mac && app.detected && (
        <span className="flex items-center gap-2 text-[11px] text-ac-muted">
          Launcher
          <Switch
            label={`Launcher for ${app.name} as ${a.name}`}
            checked={on}
            disabled={!s.act.setLauncher}
            onChange={(next) => void s.act.setLauncher?.(app.id, a.id, next).catch(failed(s, next ? "Couldn't create the launcher" : "Couldn't remove the launcher"))}
          />
        </span>
      )}
      {app.detected && menu.length > 0 && (
        <RowMenu
          items={menu}
          trigger={
            <IconButton label={`More for ${app.name} as ${a.name}`}>
              <MoreHorizontal />
            </IconButton>
          }
        />
      )}
    </div>
  );
}

/** Bundle `iP`: the desktop apps agent-switch can open on an account. */
export function Apps() {
  const s = useAS();
  const mac = s.platform === "mac";
  return (
    <div className="flex flex-col gap-6">
      <Card className="flex items-start gap-3 p-4" style={{ boxShadow: "inset 3px 0 0 var(--ac-info)" }}>
        <CircleCheck className="mt-0.5 size-4 shrink-0 text-ac-info" />
        <div className="min-w-0">
          <p className="text-[13px] text-ac-text">{s.surfaces.length ? foundLine(s.surfaces) : "No desktop apps are registered yet."}</p>
          <p className="mt-1 text-xs text-ac-muted">
            {mac
              ? "Nothing was changed. Your Dock and app icons are untouched — a launcher is added only when you switch it on."
              : "Nothing was changed. Launchers are available on macOS only; open an app on an account from its row here."}
          </p>
        </div>
      </Card>
      {!s.surfaces.length && (
        <EmptyState title="No apps to show." detail="Desktop apps appear here once agent-switch knows how to open them on an account." />
      )}
      {APP_TOOLS.flatMap((tool) => s.surfaces.filter((o) => o.tool === tool)).map((app) => {
        const accounts = s.accounts.filter((a) => a.tool === app.tool && !a.disabled);
        return (
          <section key={app.id} className="flex flex-col gap-1">
            <SectionHeader title={app.name} count={accounts.length} />
            <Card className="p-1">
              <div className="flex items-center gap-2 px-3 pb-1 pt-2 text-[11px] text-ac-muted">
                {!app.detected && (
                  <span className="inline-flex items-center gap-1 text-ac-faint">
                    <EyeOff className="size-3" /> not found on this computer
                  </span>
                )}
                {app.detected && <span>{surfaceSub(app, s.now)}</span>}
              </div>
              {accounts.length ? (
                <div className="flex flex-col divide-y divide-ac-line">
                  {accounts.map((a) => (
                    <AppAccountRow key={a.id} app={app} account={a} accounts={accounts} />
                  ))}
                </div>
              ) : (
                <p className="px-3 pb-2.5 text-xs text-ac-faint">No {TOOL_LABEL[app.tool]} accounts yet.</p>
              )}
            </Card>
          </section>
        );
      })}
      {mac && (
        <Card className="flex items-start gap-3 p-4">
          <Rocket className="mt-0.5 size-4 text-ac-brand-text" />
          <div>
            <p className="text-[13px] text-ac-text">What does a launcher do?</p>
            <p className="mt-1 max-w-[560px] text-xs text-ac-muted">
              It puts an app into ~/Applications/Agent Switch that opens the original app on one account — start it from Spotlight or drag it into the
              Dock. Clicking it again brings that account's window to the front. Switch it off and it's removed — nothing else to undo.
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-[11px] text-ac-faint">
              <Info className="size-3" /> The open window still shows the app's own icon and name; only the launcher carries the account.
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}
