import { CircleCheck, EyeOff, Info, MoreHorizontal, Rocket } from "lucide-react";
import { Badge } from "../../ui/Badge.js";
import { IconButton } from "../../ui/Button.js";
import { Card, EmptyState } from "../../ui/Card.js";
import { AccountDot } from "../../ui/AccountDot.js";
import { RowMenu } from "../../ui/RowMenu.js";
import { Switch } from "../../ui/Switch.js";
import { SectionHeader } from "../../ui/Typography.js";
import { ago } from "../../ui/format.js";
import { TOOL_LABEL } from "../../vm/rules.js";
import { useAS } from "../../vm/store.js";
import type { Capability, Surface, Tone, Tool } from "../../vm/types.js";

/** Design `sP`, plus the honest unknown for a capability no backend reports. */
export const CAPABILITY: Record<Capability | "unknown", { label: string; tone: Tone; hint: string }> = {
  native: { label: "Full", tone: "ok", hint: "Accounts, bindings and protection work here." },
  "opt-in-launch": { label: "With launcher", tone: "info", hint: "Works when opened through its own launcher. The normal app stays as it is." },
  "monitor-only": { label: "Monitor only", tone: "neutral", hint: "Agent Switch shows status and warns, but changes nothing." },
  unsupported: { label: "Not supported", tone: "neutral", hint: "Agent Switch can't work with this yet." },
  planned: { label: "Planned", tone: "violet", hint: "On the roadmap." },
  unknown: { label: "Unknown", tone: "neutral", hint: "No backend reports yet what Agent Switch can do in this app." },
};

/** Design `aP`. */
export const APP_TOOLS: Tool[] = ["claude", "codex", "gemini", "antigravity"];

export const LAUNCHER_UNAVAILABLE = "Own launchers are not available yet — Agent Switch has no launcher backend.";

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

/** Bundle `iP`. */
export function Apps() {
  const s = useAS();
  return (
    <div className="flex flex-col gap-6">
      <Card className="flex items-start gap-3 p-4" style={{ boxShadow: "inset 3px 0 0 var(--ac-info)" }}>
        <CircleCheck className="mt-0.5 size-4 shrink-0 text-ac-info" />
        <div className="min-w-0">
          <p className="text-[13px] text-ac-text">{s.surfaces.length ? foundLine(s.surfaces) : "No desktop apps are registered yet."}</p>
          <p className="mt-1 text-xs text-ac-muted">
            Nothing was changed. Your Dock, Start menu and app icons are untouched — launchers are added only when you switch them on.
          </p>
        </div>
      </Card>
      {!s.surfaces.length && (
        <EmptyState title="No apps to show." detail="Desktop apps appear here once agent-switch knows how to open them on an account." />
      )}
      {APP_TOOLS.map((tool) => {
        const rows = s.surfaces.filter((o) => o.tool === tool);
        if (!rows.length) return null;
        const accounts = s.accounts.filter((a) => a.tool === tool);
        return (
          <section key={tool} className="flex flex-col gap-1">
            <SectionHeader title={TOOL_LABEL[tool]} count={rows.length} />
            <div className="hidden grid-cols-[minmax(0,1fr)_120px_minmax(150px,1fr)_120px] gap-x-4 px-3 pb-1 md:grid">
              <span className="ac-caps">App</span>
              <span className="ac-caps">Works</span>
              <span className="ac-caps">Protection</span>
              <span className="ac-caps text-right">Launcher</span>
            </div>
            <Card className="p-1">
              <div className="flex flex-col divide-y divide-ac-line">
                {rows.map((o) => {
                  const cap = CAPABILITY[o.capability ?? "unknown"];
                  return (
                    <div
                      key={o.id}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-3 py-2.5 md:grid-cols-[minmax(0,1fr)_120px_minmax(150px,1fr)_120px]"
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-[13px] font-medium text-ac-text">{o.name}</span>
                          {!o.detected && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-ac-faint">
                              <EyeOff className="size-3" /> not found
                            </span>
                          )}
                        </span>
                        <span className="truncate text-[11px] text-ac-muted">{surfaceSub(o, s.now)}</span>
                      </span>
                      <span title={cap.hint}>
                        <Badge tone={cap.tone}>{cap.label}</Badge>
                      </span>
                      <span className="col-span-2 text-xs text-ac-soft md:col-span-1">
                        {o.protection ?? <span className="text-ac-faint">Not reported</span>}
                      </span>
                      <span className="col-start-2 row-start-1 flex items-center justify-end gap-2 md:col-start-auto md:row-start-auto">
                        {o.detected && accounts.length > 0 && s.act.openApp && (
                          <RowMenu
                            items={accounts.map((a) => ({
                              id: a.id,
                              label: `Open as ${TOOL_LABEL[a.tool]} · ${a.name}`,
                              icon: <AccountDot color={a.color} size={8} />,
                              onSelect: () => {
                                s.act.openApp?.(o.id, a.id).catch((e) => s.toast({ text: e instanceof Error ? e.message : String(e), tone: "alert" }));
                              },
                            }))}
                            trigger={
                              <IconButton label={`Open ${o.name} on an account`}>
                                <MoreHorizontal />
                              </IconButton>
                            }
                          />
                        )}
                        <span title={LAUNCHER_UNAVAILABLE}>
                          <Switch label={`Own launcher for ${o.name}`} checked={o.launcher ?? false} disabled onChange={() => {}} />
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </Card>
          </section>
        );
      })}
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-start gap-3">
          <Rocket className="mt-0.5 size-4 text-ac-brand-text" />
          <div>
            <p className="text-[13px] text-ac-text">What does a launcher do?</p>
            <p className="mt-1 max-w-[560px] text-xs text-ac-muted">
              It opens the original app with one account's own folder, in that account's colour. Clicking it again focuses the open window. Switch it
              off and it's removed — nothing else to undo.
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-[11px] text-ac-faint">
              <Info className="size-3" /> {LAUNCHER_UNAVAILABLE}
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
