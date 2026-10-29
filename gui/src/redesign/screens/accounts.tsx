import { useEffect, useState } from "react";
import { resolvePlainStart, type DirResolution } from "../../ipc.js";
import { Ellipsis, LogIn, Plus, RefreshCw, ShieldCheck, ShieldOff, SquareTerminal } from "lucide-react";
import { cn } from "../../lib/utils.js";
import { AccountDot } from "../../ui/AccountDot.js";
import { Badge } from "../../ui/Badge.js";
import { Button, IconButton } from "../../ui/Button.js";
import { Card } from "../../ui/Card.js";
import { UsageWindowStack } from "../../ui/Meters.js";
import { RowMenu } from "../../ui/RowMenu.js";
import { Segmented } from "../../ui/Segmented.js";
import { PageHeader, SectionHeader } from "../../ui/Typography.js";
import { nextInPools, rankAccounts, TOOL_LABEL, type RankedAccount } from "../../vm/rules.js";
import { useAS } from "../../vm/store.js";
import type { Account, Tool } from "../../vm/types.js";
import { ACCOUNT_TOOLS, protectTitle, usedIn } from "./account-logic.js";
import { accountMenu, startAs, makeDefault } from "./account-actions.js";
import { plainStart, plainStartFromCli } from "./logic.js";
import { ProjectsPools } from "./projects-pools.js";
import { AccountStateBadge, AccountSubline, RowList, rowClick } from "./rows.js";
import { UsageHistory } from "./usage-history.js";

// -------------------------------------------------------------------- rows

/** Protect column. Bundle `cP`; `protection` null = not read → "—". */
function ProtectCell({ account: a }: { account: Account }) {
  const p = a.protection;
  const on = !!p?.enabled;
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap text-[11px]", on ? "text-ac-soft" : "text-ac-faint")} title={protectTitle(p)}>
      {p == null ? "—" : on ? <ShieldCheck className="size-3.5 text-ac-ok" /> : <ShieldOff className="size-3.5" />}
      {p == null ? null : on ? `${p.thresholdPct} %` : "Off"}
    </span>
  );
}

const ACCOUNT_GRID = "md:grid-cols-[minmax(0,1fr)_112px_minmax(190px,250px)_52px_150px]";

/** Full account row of the Accounts screen. Bundle `Bd` (non-compact). */
export function AccountRow({ account: a, ranked, showRank, nextIn }: { account: Account; ranked?: RankedAccount; showRank?: boolean; nextIn?: string }) {
  const s = useAS();
  const signedOut = a.state === "signed-out";
  return (
    <div
      {...rowClick(() => s.open({ kind: "account", id: a.id }))}
      data-account-row
      data-disabled={a.disabled ? "true" : undefined}
      className={cn(
        "grid cursor-pointer items-center gap-x-4 gap-y-2 rounded-lg px-3 py-2.5 transition-colors hover:bg-ac-raise",
        "grid-cols-[minmax(0,1fr)_auto]",
        ACCOUNT_GRID,
        a.disabled && "opacity-55",
      )}
    >
      <button type="button" data-row-main className="flex min-w-0 items-center gap-3 text-left">
        {ranked && showRank && (
          <span className={cn("w-5 shrink-0 text-right font-ac-mono text-[11px]", ranked.rank === 1 ? "text-ac-brand-text" : "text-ac-faint")}>
            {ranked.rank ? `#${ranked.rank}` : "–"}
          </span>
        )}
        <AccountDot color={a.color} ring={a.liveSessions > 0} />
        <span className="flex min-w-0 flex-col">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[13px] font-medium text-ac-text">{a.name}</span>
            {a.disabled && <Badge>Disabled</Badge>}
            {a.desktopForeign && (
              <span title={`Its Claude Desktop window is signed in as ${a.desktopForeign.join(", ")} — sessions there count against that account.`}>
                <Badge tone="warn" dot>
                  Desktop: {a.desktopForeign.join(", ")}
                </Badge>
              </span>
            )}
            {a.isDefault && <Badge tone="brand">Default</Badge>}
            {nextIn && <Badge tone="info">Next in {nextIn}</Badge>}
            {!a.disabled && <AccountStateBadge account={a} />}
          </span>
          <AccountSubline account={a} signedOut={signedOut} />
        </span>
      </button>
      <span className="hidden min-w-0 flex-col md:flex">
        <span className="truncate text-xs text-ac-soft">{usedIn(a)}</span>
        <span className="text-[11px] text-ac-faint">{a.liveSessions ? `${a.liveSessions} running` : "idle"}</span>
      </span>
      <div className="col-span-2 md:col-span-1">
        {signedOut ? (
          <span className="text-[11px] text-ac-faint">{a.windows.length ? "Usage resumes after the sign-in" : "No usage before the first sign-in"}</span>
        ) : (
          <UsageWindowStack windows={a.windows} threshold={a.threshold} checkedAt={a.checkedAt} now={s.now} />
        )}
      </div>
      <span className="hidden md:block">
        <ProtectCell account={a} />
      </span>
      <div className="col-start-2 row-start-1 flex items-center justify-end gap-1 md:col-start-auto md:row-start-auto">
        {signedOut || a.state === "wrong-account" ? (
          <Button size="sm" variant="primary" onClick={() => s.open({ kind: "reauth", accountId: a.id })}>
            <LogIn /> Sign in
          </Button>
        ) : (
          <>
            {!a.isDefault && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => makeDefault(a, s)}
                title="Use for plain starts — what a plain `claude` / `codex` picks when no binding matches"
              >
                Use
              </Button>
            )}
            <IconButton label="Start session as this account" onClick={() => startAs(a, s)}>
              <SquareTerminal />
            </IconButton>
          </>
        )}
        <RowMenu
          items={accountMenu(a, s)}
          trigger={
            <IconButton label={`More for ${a.name}`}>
              <Ellipsis />
            </IconButton>
          }
        />
      </div>
    </div>
  );
}

/** Column header. Bundle `pP`. */
function AccountColumns({ ranked, threshold }: { ranked?: boolean; threshold: number }) {
  return (
    <div className={cn("hidden gap-x-4 px-3 pb-1 md:grid", ACCOUNT_GRID)}>
      <span className={cn("ac-caps", ranked && "pl-8")}>Account</span>
      <span className="ac-caps">Used in</span>
      <span className="ac-caps" title={`Binding window. The tick on each bar marks where protection warns (${threshold} %).`}>
        Capacity
      </span>
      <span className="ac-caps" title="Session protection">
        Protect
      </span>
      <span className="ac-caps text-right">&nbsp;</span>
    </div>
  );
}

// ------------------------------------------------------------------ screen

/** "next refresh in 7 min" + Refresh. Bundle `BP`. */
function RefreshControl() {
  const s = useAS();
  const [busy, setBusy] = useState(false);
  const mins = s.usageNextAt ? Math.max(0, Math.round((s.usageNextAt - s.now) / 60_000)) : null;
  return (
    <span className="flex items-center gap-2 text-xs text-ac-faint">
      {mins != null && <span title="Automatic refresh — Settings › General">next refresh in {mins} min</span>}
      <Button
        size="sm"
        variant="ghost"
        disabled={busy || !s.act.refreshUsage}
        onClick={() => {
          setBusy(true);
          void (s.act.refreshUsage?.() ?? Promise.resolve())
            .catch((e: unknown) => s.toast({ tone: "alert", text: `Couldn't refresh: ${e instanceof Error ? e.message : String(e)}` }))
            .finally(() => setBusy(false));
        }}
      >
        <RefreshCw className={cn(busy && "animate-spin")} /> {busy ? "Refreshing …" : "Refresh"}
      </Button>
    </span>
  );
}

/** What a plain `claude` does where no folder rule applies (the general case). */
function PlainStartLine({ tool }: { tool: Tool }) {
  const s = useAS();
  const [answer, setAnswer] = useState<DirResolution | null>(null);
  // Re-ask whenever the readouts change: the pick follows usage and resets.
  const key = s.accounts
    .filter((a) => a.tool === tool)
    .map((a) => `${a.id}:${a.isDefault}:${a.disabled}:${a.state}:${a.checkedAt}`)
    .join("|");
  useEffect(() => {
    if (tool === "gemini") return;
    let alive = true;
    resolvePlainStart(tool).then(
      (r) => alive && setAnswer(r),
      () => alive && setAnswer(null),
    );
    return () => {
      alive = false;
    };
  }, [tool, key]);
  const p = answer ? plainStartFromCli(s.accounts, tool, s.rules, answer) : plainStart(s.accounts, tool, s.rules);
  return (
    <div
      role="note"
      aria-label={p.text}
      title={[p.text, ...p.why].join("\n")}
      className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-ac-line bg-ac-panel px-3 py-2"
    >
      <span className="flex min-w-0 flex-1 items-center gap-2 text-xs text-ac-muted">
        <SquareTerminal className="size-3.5 shrink-0 text-ac-faint" />
        <span className="shrink-0">
          Plain <code className="font-ac-mono text-[11px] text-ac-soft">{p.command}</code> starts on
        </span>
        {p.account ? (
          <span className="flex min-w-0 items-center gap-1.5">
            <AccountDot color={p.account.color} size={8} />
            <span className="truncate text-[13px] font-medium text-ac-text">{p.account.name}</span>
          </span>
        ) : (
          <span className="truncate text-ac-soft">your original {TOOL_LABEL[tool]} login</span>
        )}
        {p.warn && (
          <Badge tone="warn" dot>
            <span title={p.warn}>{p.account?.state === "signed-out" ? "Signed out" : p.account?.state === "limited" ? "At its limit" : "Check this account"}</span>
          </Badge>
        )}
      </span>
      <span className="text-[11px] text-ac-faint">
        {p.reason ?? (p.rules ? `Folders with a rule (${p.rules}) use their own` : p.account ? "No folder rules" : "Pick one: ⋯ → Use for plain starts")}
      </span>
    </div>
  );
}

type Order = "headroom" | "name";

/** Accounts per provider. Bundle `WP`. */
function AccountGroups({ order }: { order: Order }) {
  const s = useAS();
  const enabled = new Set(s.providers.filter((p) => p.cli && !p.planned).map((p) => p.id));
  return (
    <>
      {ACCOUNT_TOOLS.map((tool) => {
        const ranked = rankAccounts(s.accounts, tool, s.now);
        if (!ranked.length)
          return enabled.has(tool) ? (
            <section key={tool} className="flex flex-col gap-1">
              <SectionHeader title={TOOL_LABEL[tool]} count={0} />
              <Card className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <span className="text-xs text-ac-muted">No {TOOL_LABEL[tool]} accounts yet.</span>
                <Button size="sm" onClick={() => s.open({ kind: "add-account", tool })}>
                  <Plus /> Add a {TOOL_LABEL[tool]} account
                </Button>
              </Card>
            </section>
          ) : null;
        const rows =
          order === "headroom"
            ? ranked
            : s.accounts
                .filter((a) => a.tool === tool)
                .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
                .map((a) => ranked.find((r) => r.account.id === a.id) as RankedAccount);
        const next = nextInPools(s.accounts, tool, s.pools, s.now);
        const threshold = ranked[0]?.account.threshold ?? 98;
        return (
          <section key={tool} className="flex flex-col gap-1">
            <SectionHeader
              title={TOOL_LABEL[tool]}
              count={ranked.length}
              actions={
                <Button size="sm" variant="ghost" onClick={() => s.open({ kind: "add-account", tool })}>
                  <Plus /> Add
                </Button>
              }
            />
            <PlainStartLine tool={tool} />
            <AccountColumns ranked={order === "headroom"} threshold={threshold} />
            <Card className="p-1">
              <RowList>
                {rows.map((r) => (
                  <AccountRow key={r.account.id} account={r.account} ranked={r} showRank={order === "headroom"} nextIn={next.get(r.account.id)} />
                ))}
              </RowList>
            </Card>
          </section>
        );
      })}
    </>
  );
}

/** Bundle `UP`. */
export function Accounts() {
  const s = useAS();
  const [order, setOrder] = useState<Order>("headroom");
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Who is signed in where?"
        sub="Each account with its sign-in, where it is used, what is left and whether its sessions are protected."
        actions={
          <Button variant="primary" onClick={() => s.open({ kind: "add-account" })}>
            <Plus /> Add account
          </Button>
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="View"
          value={s.accountsTab}
          onChange={s.setAccountsTab}
          options={[
            { value: "accounts", label: `Accounts ${s.accounts.length}` },
            { value: "history", label: "Usage history" },
            { value: "projects", label: `Projects & pools ${s.rules.length}` },
          ]}
        />
        {s.accountsTab !== "projects" && (
          <span className="flex flex-wrap items-center gap-3">
            <RefreshControl />
            {s.accountsTab === "accounts" && (
              <Segmented
                label="Order"
                value={order}
                onChange={setOrder}
                options={[
                  { value: "headroom", label: "Most left first" },
                  { value: "name", label: "A–Z" },
                ]}
              />
            )}
          </span>
        )}
      </div>
      {s.accountsTab === "accounts" ? <AccountGroups order={order} /> : s.accountsTab === "history" ? <UsageHistory /> : <ProjectsPools />}
    </div>
  );
}
