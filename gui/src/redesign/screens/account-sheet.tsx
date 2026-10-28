import { useState } from "react";
import { AppWindow, Check, ExternalLink, Power, Star, Trash2 } from "lucide-react";
import { cn } from "../../lib/utils.js";
import type { ProfileLabel } from "../../transforms.js";
import { AccountDot, identityColor } from "../../ui/AccountDot.js";
import { Badge } from "../../ui/Badge.js";
import { Button } from "../../ui/Button.js";
import { DefinitionList } from "../../ui/Card.js";
import { ago, expiry } from "../../ui/format.js";
import { UsageWindowRow } from "../../ui/Meters.js";
import { Sheet, SheetSection } from "../../ui/Overlay.js";
import { Segmented } from "../../ui/Segmented.js";
import { SessionStateIcon } from "../../ui/SessionStateIcon.js";
import { Switch } from "../../ui/Switch.js";
import { TextInput } from "../../ui/TextInput.js";
import { isStale, nextInPools, TOOL_LABEL } from "../../vm/rules.js";
import { useAS } from "../../vm/store.js";
import { IDENTITY_COLORS, type AuthHealth, type AuthState, type IdentityColor } from "../../vm/types.js";
import { attempt, confirmRedeem, confirmRemove, makeDefault, turnOffPlainStarts } from "./account-actions.js";
import { canSaveName, hasReadout } from "./account-logic.js";
import { appFor } from "./logic.js";
import { AccountStateBadge } from "./rows.js";
import { Sparkline, useUsageHistory } from "./usage-history.js";

const LABELS: ProfileLabel[] = ["Work", "Personal", "Other"];

const AUTH_BADGE: Record<AuthState, { label: string; tone: "ok" | "info" | "warn" | "alert" | "neutral" }> = {
  connected: { label: "Connected", tone: "ok" },
  refreshing: { label: "Refreshing", tone: "info" },
  expiring: { label: "Expires soon", tone: "warn" },
  "sign-in-needed": { label: "Sign-in needed", tone: "warn" },
  "wrong-account": { label: "Wrong account", tone: "alert" },
  unknown: { label: "Unknown", tone: "neutral" },
};

const UNKNOWN_AUTH: AuthHealth = {
  state: "unknown",
  expiresAt: null,
  lastRefreshAt: null,
  checkedAt: null,
  method: null,
  autoRefresh: null,
  keptFreshBy: null,
};

const DERIVED_COLOUR = "The colour follows the account's name — Agent Switch can't store a chosen colour yet.";

/** Colour swatches. Bundle `_0`. No backend stores a colour: the swatches show
 *  the derived one and stay read-only. */
export function ColourPicker({ value }: { value: IdentityColor }) {
  return (
    <div className="flex flex-col gap-1.5" title={DERIVED_COLOUR}>
      <span className="ac-caps">Colour</span>
      <div role="radiogroup" aria-label="Account colour" className="flex flex-wrap gap-2">
        {IDENTITY_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={value === c}
            aria-label={c}
            title={c}
            disabled
            className={cn(
              "inline-flex size-8 items-center justify-center rounded-md border transition-colors disabled:cursor-default",
              value === c ? "border-ac-brand-line bg-ac-brand-tint" : "border-ac-line opacity-60",
            )}
          >
            <span className="inline-flex size-4 items-center justify-center rounded-full" style={{ background: identityColor(c) }}>
              {value === c && <Check className="size-3 text-ac-on-color" strokeWidth={3} />}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Bundle `M0`. */
export function TagPicker({ value, onChange }: { value: ProfileLabel | null; onChange: (v: ProfileLabel) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="ac-caps">Tag</span>
      <Segmented<ProfileLabel | "">
        label="Tag"
        value={value ?? ""}
        onChange={(v) => v && onChange(v)}
        options={LABELS.map((l) => ({ value: l, label: l }))}
      />
      <span className="text-[11px] text-ac-faint">Describes the account. Shown in lists and used to suggest pools.</span>
    </div>
  );
}

/** Bundle `T0`. */
export function PoolsPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const s = useAS();
  return (
    <div className="flex flex-col gap-1.5">
      <span className="ac-caps">Pools · optional</span>
      <div className="flex flex-wrap gap-1.5">
        {s.pools.map((p) => {
          const on = value.includes(p.id);
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? value.filter((x) => x !== p.id) : [...value, p.id])}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors",
                on ? "border-ac-brand-line bg-ac-brand-tint text-ac-text" : "border-ac-line text-ac-muted hover:border-ac-line2 hover:text-ac-text",
              )}
            >
              {on && <Check className="size-3" />} {p.label}
            </button>
          );
        })}
      </div>
      <span className="text-[11px] text-ac-faint">A project bound to a pool may use any of its accounts. Pools never add up provider limits.</span>
    </div>
  );
}

/** Account detail sheet. Bundle `GP` (sheet 500). */
export function AccountSheet({ id }: { id: string }) {
  const s = useAS();
  const a = s.accountById(id);
  const [protOn, setProtOn] = useState(a?.protection?.enabled ?? true);
  const [name, setName] = useState(a?.name ?? "");
  const [label, setLabel] = useState<ProfileLabel | null>(a?.label ?? null);
  const [pools, setPools] = useState<string[]>(a?.pools ?? []);
  const history = useUsageHistory(a ? [a] : [], s.now);
  if (!a) return null;
  const acc = a;
  const auth = a.auth ?? UNKNOWN_AUTH;
  const app = appFor(s, a.tool);
  const next = nextInPools(s.accounts, a.tool, s.pools, s.now).get(a.id);
  const sessions = s.sessions.filter((x) => x.accountId === a.id && !x.trashed);
  const surfaces = s.surfaces.filter((x) => x.tool === a.tool);
  const valid = canSaveName(name, a.name);

  function save() {
    if (!valid) return;
    const nextName = name.trim() || acc.name;
    const act = s.act;
    const protChanged = protOn !== (acc.protection?.enabled ?? true);
    const added = pools.filter((p) => !acc.pools.includes(p));
    const removed = acc.pools.filter((p) => !pools.includes(p));
    const labelChanged = label !== acc.label;
    attempt(
      s,
      (async () => {
        // Everything keyed by the old id first; the rename changes the id.
        if (protChanged) await act.setProtection?.(acc.id, { enabled: protOn });
        for (const p of added) await act.setPoolMembership?.(p, acc.id, true);
        for (const p of removed) await act.setPoolMembership?.(p, acc.id, false);
        if (labelChanged || nextName !== acc.name) {
          await act.updateAccount?.(acc.id, { ...(labelChanged ? { label } : {}), ...(nextName !== acc.name ? { name: nextName } : {}) });
        }
      })(),
      `Couldn't save ${acc.name}`,
    );
    s.update((vm) => ({
      accounts: vm.accounts.map((m) =>
        m.id === acc.id
          ? { ...m, name: nextName, label, pools, protection: m.protection ? { ...m.protection, enabled: protOn } : m.protection }
          : m,
      ),
      pools: vm.pools.map((p) => ({
        ...p,
        accountIds: pools.includes(p.id) ? Array.from(new Set([...p.accountIds, acc.id])) : p.accountIds.filter((x) => x !== acc.id),
      })),
    }));
    s.close();
  }

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && s.close()}
      kicker={`${TOOL_LABEL[a.tool]} account`}
      title={
        <span className="inline-flex items-center gap-2.5">
          <AccountDot color={a.color} size={12} /> {a.name}
        </span>
      }
      width={500}
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={() => s.close()}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" onClick={save} disabled={!valid}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <SheetSection
          title="Identity"
          aside={
            <span className="flex items-center gap-1">
              {app && (
                <Button size="sm" variant="ghost" onClick={() => attempt(s, s.act.openApp?.(app, a.id), "Couldn't open the app")} disabled={a.state === "signed-out"}>
                  <AppWindow /> Open {TOOL_LABEL[a.tool]} app
                </Button>
              )}
              {a.isDefault ? (
                <Button size="sm" variant="ghost" onClick={() => turnOffPlainStarts(a, s)} title="Plain starts use your original login">
                  <Power /> Turn off
                </Button>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => makeDefault(a, s)} disabled={a.state === "signed-out"}>
                  <Star /> Use for plain starts
                </Button>
              )}
            </span>
          }
        >
          <div className="flex flex-wrap items-center gap-2">
            {a.isDefault && <Badge tone="brand">Default</Badge>}
            {next && <Badge tone="info">Next in {next}</Badge>}
            {!["signed-out", "wrong-account", "checking"].includes(a.state) && <AccountStateBadge account={a} />}
          </div>
          <DefinitionList
            rows={[
              ["Signed in as", a.identity ?? "—"],
              ["Plan", a.plan ?? "—"],
              ["Tag", a.label ?? "—"],
              ["Pools", a.pools.map((p) => s.pools.find((x) => x.id === p)?.label ?? p).join(", ") || "—"],
            ]}
          />
        </SheetSection>

        <SheetSection title="Sign-in">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={AUTH_BADGE[auth.state].tone} dot>
              {auth.state === "expiring" && auth.expiresAt ? `Expires ${expiry(auth.expiresAt, s.now)}` : AUTH_BADGE[auth.state].label}
            </Badge>
            {auth.checkedAt && <span className="text-[11px] text-ac-faint">checked {ago(auth.checkedAt, s.now)}</span>}
          </div>
          <DefinitionList
            rows={[
              ["Expires", auth.expiresAt ? `${expiry(auth.expiresAt, s.now)} — moves on with each refresh` : "Not reported by the provider"],
              ["Last refresh", auth.lastRefreshAt ? ago(auth.lastRefreshAt, s.now) : "—"],
              ["Kept fresh by", auth.keptFreshBy ?? auth.method ?? "—"],
            ]}
          />
          {(a.state === "signed-out" || a.state === "wrong-account") && (
            <div className="flex items-center justify-between gap-3 rounded-md border border-ac-line px-3 py-2">
              <span className="text-xs text-ac-muted">{auth.reason ?? "This account needs a sign-in."}</span>
              <Button size="sm" variant="primary" onClick={() => s.open({ kind: "reauth", accountId: a.id })}>
                Sign in
              </Button>
            </div>
          )}
        </SheetSection>

        <SheetSection title="Used in">
          <div className="flex flex-col gap-1.5">
            {surfaces.map((x) => {
              const used = a.surfaces.includes(x.name);
              return (
                <div key={x.id} className="flex items-center justify-between gap-3 text-xs">
                  <span className={used ? "text-ac-text" : "text-ac-faint"}>{x.name}</span>
                  <span className="text-ac-muted">{used ? (x.kind === "desktop" ? (x.launcher ? "Own launcher" : "Via Agent Switch") : "Yes") : "—"}</span>
                </div>
              );
            })}
          </div>
        </SheetSection>

        <SheetSection title="Session protection" aside={<Switch label="Session protection" checked={protOn} onChange={setProtOn} disabled={!s.act.setProtection} />}>
          <p className="text-xs text-ac-muted">
            {protOn
              ? `At ${a.threshold} % of the binding window, Agent Switch warns you — it doesn't pause sessions yet. A running session is never moved to another account on its own.`
              : "Off — sessions run until the provider stops them."}
          </p>
          {protOn && (
            <div className="flex flex-col gap-1">
              {surfaces
                .filter((x) => a.surfaces.includes(x.name))
                .map((x) => (
                  <div key={x.id} className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-ac-soft">{x.name}</span>
                    <span className={x.capability === "native" ? "text-ac-ok-text" : "text-ac-muted"}>{x.protection}</span>
                  </div>
                ))}
            </div>
          )}
        </SheetSection>

        {a.windows.length > 0 && (
          <SheetSection
            title="Capacity"
            aside={
              <span className={cn("text-[11px]", isStale(a.checkedAt, s.now) ? "text-ac-warn-text" : "text-ac-faint")}>
                checked {a.checkedAt ? ago(a.checkedAt, s.now) : "never"}
              </span>
            }
          >
            {a.windows.map((w) => (
              <UsageWindowRow key={w.key} window={w} threshold={a.threshold} now={s.now} />
            ))}
            {hasReadout(history[a.id]) && (
              <div className="flex flex-col gap-1">
                <Sparkline values={history[a.id]} color={identityColor(a.color)} />
                <span className="text-[11px] text-ac-faint">Week window, peak per day, last 30 days</span>
              </div>
            )}
            {a.tool === "claude" ? (
              <div className="flex items-center justify-between gap-3 rounded-md border border-ac-line px-3 py-2">
                <span className="text-xs text-ac-muted">Claude sometimes offers a free reset. Agent Switch can't see offers — check at Claude.</span>
                <Button size="sm" variant="ghost" disabled={!s.act.openUsagePage} onClick={() => attempt(s, s.act.openUsagePage?.(a.id), "Couldn't open Claude")}>
                  <ExternalLink /> Check
                </Button>
              </div>
            ) : a.resetCredits != null ? (
              <div className="flex items-center justify-between gap-3 rounded-md border border-ac-line px-3 py-2">
                <span className="text-xs text-ac-muted">
                  {a.resetCredits} reset credit{a.resetCredits === 1 ? "" : "s"} available
                </span>
                <Button size="sm" variant="ghost" disabled={!a.resetCredits} onClick={() => confirmRedeem(a, s)}>
                  Redeem one
                </Button>
              </div>
            ) : null}
          </SheetSection>
        )}

        <SheetSection title={`Sessions · ${sessions.length}`}>
          {sessions.length ? (
            <div className="flex flex-col gap-1.5">
              {sessions.map((x) => (
                <button
                  key={x.id}
                  type="button"
                  onClick={() => s.open({ kind: "session", id: x.id })}
                  className="flex items-center gap-2.5 rounded-md px-1 py-1 text-left text-xs hover:bg-ac-raise"
                >
                  <SessionStateIcon state={x.state} />
                  <span className="min-w-0 flex-1 truncate text-ac-text">
                    {x.project} · {x.title}
                  </span>
                  <span className="text-ac-faint">{ago(x.lastActiveAt, s.now)}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-ac-faint">No sessions on this account yet.</p>
          )}
        </SheetSection>

        <SheetSection title="Name, colour, tag & pools">
          <div className="flex flex-col gap-1.5">
            <label className="ac-caps" htmlFor="acc-name">
              Name
            </label>
            <TextInput
              id="acc-name"
              mono
              className="h-9"
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase())}
              onKeyDown={(e) => e.key === "Enter" && save()}
            />
            <span className="text-[11px] text-ac-faint">Lowercase letters, digits and dashes. Renaming keeps the sign-in and the sessions.</span>
          </div>
          <ColourPicker value={a.color} />
          <TagPicker value={label} onChange={setLabel} />
          <PoolsPicker value={pools} onChange={setPools} />
        </SheetSection>

        <SheetSection title="Danger zone">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-ac-muted">Removes this account's folder from Agent Switch. Your original login is untouched.</span>
            <Button size="sm" variant="danger" onClick={() => confirmRemove(a, s)}>
              <Trash2 /> Remove …
            </Button>
          </div>
        </SheetSection>
      </div>
    </Sheet>
  );
}
