import { CircleCheck, EyeOff, Info, MoreHorizontal, Rocket, SlidersHorizontal } from "lucide-react";
import { Button, IconButton } from "../../ui/Button.js";
import { Card, EmptyState } from "../../ui/Card.js";
import { AccountDot } from "../../ui/AccountDot.js";
import { RowMenu } from "../../ui/RowMenu.js";
import { Switch } from "../../ui/Switch.js";
import { SectionHeader } from "../../ui/Typography.js";
import { ago } from "../../ui/format.js";
import { t } from "../../i18n/index.js";
import { TOOL_LABEL } from "../../vm/rules.js";
import { useAS, type Store } from "../../vm/store.js";
import type { Account, Surface, Tool } from "../../vm/types.js";
import { hasLauncher } from "./logic.js";

/** Design `aP`. */
export const APP_TOOLS: Tool[] = ["claude", "codex", "gemini", "antigravity"];

/** "Found 2 of 3: Claude Desktop, Codex." */
export function foundLine(surfaces: readonly Surface[]): string {
  const found = surfaces.filter((x) => x.detected);
  return t("tools.apps.found", { found: found.length, total: surfaces.length, names: found.map((x) => x.name).join(", ") });
}

/** Secondary line of an app row (design `iP`); the age only when one was read. */
export function surfaceSub(o: Surface, now: number): string {
  const what =
    o.note ??
    (o.identitySeen === "per session" ? t("tools.apps.perSession") : o.identitySeen ? t("tools.apps.runningAs", { who: o.identitySeen }) : o.kind.toUpperCase());
  return o.checkedAt != null ? `${what} · ${t("tools.checked", { ago: ago(o.checkedAt, now) })}` : what;
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
      title: t("tools.apps.copyTitle", { app: app.name, account: a.name }),
      body: t("tools.apps.copyBody", { source: label, app: app.name, account: a.name }),
      confirm: t("tools.apps.copyConfirm"),
      onConfirm: () => {
        s.act.copyAppSettings?.(app.id, from, a.id).then(
          () => s.toast({ tone: "ok", text: t("tools.apps.copied", { app: app.name, account: a.name }) }),
          failed(s, t("tools.apps.copyFailed")),
        );
      },
    });
  const menu = [
    ...(s.act.openApp ? [{ id: "open", label: t("tools.apps.openAs", { who }), icon: <AccountDot color={a.color} size={8} />, onSelect: () => s.act.openApp?.(app.id, a.id).catch(failed(s, t("tools.apps.openFailed", { app: app.name }))) }] : []),
    ...(app.copiesSettings && s.act.copyAppSettings
      ? [
          { id: "copy:default", label: t("tools.apps.copyFromDefault", { app: app.name }), icon: <SlidersHorizontal />, onSelect: () => copyFrom("default", t("tools.apps.theDefault", { app: app.name })) },
          ...accounts
            .filter((x) => x.id !== a.id)
            .map((x) => ({ id: `copy:${x.id}`, label: t("tools.apps.copyFrom", { who: `${TOOL_LABEL[x.tool]} · ${x.name}` }), icon: <SlidersHorizontal />, onSelect: () => copyFrom(x.id, x.name) })),
        ]
      : []),
  ];
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <AccountDot color={a.color} size={8} />
      <span className="min-w-0 flex-1 truncate text-[13px] text-ac-text">{a.name}</span>
      {app.detected && s.act.openApp && (
        <Button size="sm" variant="ghost" onClick={() => s.act.openApp?.(app.id, a.id).catch(failed(s, t("tools.apps.openFailed", { app: app.name })))}>
          {t("common.open")}
        </Button>
      )}
      {mac && app.detected && (
        <span className="flex items-center gap-2 text-[11px] text-ac-muted">
          {t("tools.apps.launcher")}
          <Switch
            label={t("tools.apps.launcherFor", { app: app.name, account: a.name })}
            checked={on}
            disabled={!s.act.setLauncher}
            onChange={(next) => void s.act.setLauncher?.(app.id, a.id, next).catch(failed(s, t(next ? "tools.apps.launcherCreateFailed" : "tools.apps.launcherRemoveFailed")))}
          />
        </span>
      )}
      {app.detected && menu.length > 0 && (
        <RowMenu
          items={menu}
          trigger={
            <IconButton label={t("tools.apps.moreFor", { app: app.name, account: a.name })}>
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
          <p className="text-[13px] text-ac-text">{s.surfaces.length ? foundLine(s.surfaces) : t("tools.apps.noneRegistered")}</p>
          <p className="mt-1 text-xs text-ac-muted">
            {t(mac ? "tools.apps.nothingChangedMac" : "tools.apps.nothingChangedOther")}
          </p>
        </div>
      </Card>
      {!s.surfaces.length && (
        <EmptyState title={t("tools.apps.emptyTitle")} detail={t("tools.apps.emptyDetail")} />
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
                    <EyeOff className="size-3" /> {t("tools.apps.notFound")}
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
                <p className="px-3 pb-2.5 text-xs text-ac-faint">{t("tools.apps.noAccounts", { tool: TOOL_LABEL[app.tool] })}</p>
              )}
            </Card>
          </section>
        );
      })}
      {mac && (
        <Card className="flex items-start gap-3 p-4">
          <Rocket className="mt-0.5 size-4 text-ac-brand-text" />
          <div>
            <p className="text-[13px] text-ac-text">{t("tools.apps.launcherQ")}</p>
            <p className="mt-1 max-w-[560px] text-xs text-ac-muted">
              {t("tools.apps.launcherA")}
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-[11px] text-ac-faint">
              <Info className="size-3" /> {t("tools.apps.launcherNote")}
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}
