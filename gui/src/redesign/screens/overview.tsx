import { useState } from "react";
import { CircleCheck, Download, X } from "lucide-react";
import { getAgentConfigCardDismissed, getSessionMonitoring, setAgentConfigCardDismissed } from "../../settings-store.js";
import { Button, IconButton } from "../../ui/Button.js";
import { Card } from "../../ui/Card.js";
import { PageHeader, SectionHeader } from "../../ui/Typography.js";
import { nextInPools, rankAccounts, TOOL_LABEL } from "../../vm/rules.js";
import { useAS } from "../../vm/store.js";
import type { ViewModel } from "../../vm/types.js";
import { accountTools, overviewSub } from "./logic.js";
import { StarAskBanner } from "./star-ask-banner.js";
import { AttentionRow, CompactAccountRow, RowList, SessionRow } from "./rows.js";

/** "AC" monogram tile. Bundle `y0`. */
export function AcTile({ size = 40 }: { size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-lg border border-ac-brand-line bg-ac-brand-tint font-display tracking-[0.02em] text-ac-brand-text"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      AC
    </span>
  );
}

/** agent-config promo strip on Overview, only while agent-config is not
 *  installed. Dismissal reuses the legacy card's permanent local flag.
 *  Bundle `k0` variant "banner". */
export function AcPromoBanner() {
  const s = useAS();
  const [dismissed, setDismissed] = useState(getAgentConfigCardDismissed);
  if (s.agentConfig.status !== "not-installed" || dismissed) return null;
  return (
    <Card className="flex flex-wrap items-center gap-x-4 gap-y-3 border-ac-brand-line bg-ac-brand-tint px-4 py-3">
      <AcTile size={36} />
      <div className="min-w-[220px] flex-1">
        <p className="text-[13px] font-medium text-ac-text">
          Supercharge your AI agents with <span className="whitespace-nowrap">agent-config</span> — free & open source
        </p>
        <p className="mt-0.5 text-xs text-ac-muted">Skills, commands and rules in every session — Agent Switch installs and updates it for you.</p>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => s.go("tools")}>
          Learn more
        </Button>
        <Button size="sm" variant="primary" onClick={() => s.open({ kind: "terminal", toolId: "agent-config", action: "install" })}>
          <Download /> Install
        </Button>
        <IconButton
          label="Not now — it stays under Tools"
          onClick={() => {
            setAgentConfigCardDismissed();
            setDismissed(true);
          }}
        >
          <X />
        </IconButton>
      </div>
    </Card>
  );
}

/** Detected apps + installed provider CLIs ("Found on this computer"). */
export function foundOnComputer(vm: Pick<ViewModel, "surfaces" | "providers">): string[] {
  const clis = vm.providers.filter((p) => p.installed && p.cli).map((p) => `${TOOL_LABEL[p.id]} CLI`);
  const apps = vm.surfaces.filter((x) => x.detected).map((x) => x.name);
  return [...clis, ...apps];
}

/** Bundle `MP`. */
export function FirstRun() {
  const s = useAS();
  const found = foundOnComputer(s);
  return (
    <div className="mx-auto flex max-w-[620px] flex-col gap-6 pt-6">
      <PageHeader
        title="Let's add your first account"
        sub="Agent Switch keeps your accounts apart and gives every session the right one. Your tools keep working exactly as before."
      />
      <Card className="flex flex-col gap-3 p-4">
        <span className="ac-caps">Found on this computer</span>
        <ul className="flex flex-col gap-1.5">
          {found.map((name) => (
            <li key={name} className="flex items-center gap-2.5 text-[13px] text-ac-text">
              <CircleCheck className="size-4 text-ac-ok" /> {name}
            </li>
          ))}
        </ul>
        <p className="text-xs text-ac-muted">Nothing was changed. Your current logins stay where they are.</p>
      </Card>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="lg" onClick={() => s.open({ kind: "add-account" })}>
          Add account
        </Button>
        <Button
          size="lg"
          variant="ghost"
          onClick={() => {
            s.go("tools");
            s.setToolsTab("apps");
          }}
        >
          See what works where
        </Button>
      </div>
    </div>
  );
}

/** Bundle `TP`. */
export function Overview() {
  const s = useAS();
  if (!s.accounts.length) {
    if (s.readiness === "starting") return <PageHeader title="What's going on?" sub="Reading accounts and sessions …" />;
    return <FirstRun />;
  }
  const running = s.sessions.filter((x) => x.state !== "done" && !x.trashed);
  const waiting = running.filter((x) => x.state === "needs-you");
  const needs = s.attention.length + waiting.length;
  const tools = accountTools(s.accounts);
  // One promo at a time: the star ask waits while the agent-config strip shows.
  const acPromoShowing = s.agentConfig.status === "not-installed" && !getAgentConfigCardDismissed();
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="What's going on?" sub={overviewSub(s)} />
      <section aria-labelledby="needs-you" className="flex flex-col gap-3">
        <div id="needs-you">
          <SectionHeader title="Needs you" count={needs} />
        </div>
        {needs ? (
          <Card className="overflow-hidden">
            <div className="flex flex-col divide-y divide-ac-line">
              {waiting.map((x) => (
                <SessionRow key={x.id} session={x} />
              ))}
              {s.attention.map((item) => (
                <AttentionRow key={item.id} item={item} />
              ))}
            </div>
          </Card>
        ) : (
          <p className="flex flex-wrap items-center gap-2 text-[13px] text-ac-muted">
            <CircleCheck className="size-4 text-ac-ok" /> Nothing needs you. Sessions keep running on their accounts.
            {!getSessionMonitoring() && running.length > 0 && (
              <span className="text-xs text-ac-faint">
                Questions a session asks show here; a permission prompt only with{" "}
                <button type="button" className="underline underline-offset-2 hover:text-ac-text" onClick={() => s.go("settings", "notifications")}>
                  session monitoring on
                </button>
                .
              </span>
            )}
          </p>
        )}
      </section>
      <AcPromoBanner />
      {!acPromoShowing && <StarAskBanner />}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,1fr)]">
        <section aria-labelledby="running" className="flex min-w-0 flex-col gap-2">
          <div id="running">
            <SectionHeader title="Running now" count={running.length} />
          </div>
          <Card className="p-1">
            {running.length ? (
              <RowList>
                {running.map((x) => (
                  <SessionRow key={x.id} session={x} compact />
                ))}
              </RowList>
            ) : (
              <p className="px-3 py-2.5 text-xs text-ac-muted">Nothing runs right now.</p>
            )}
          </Card>
        </section>
        <section aria-labelledby="left" className="flex min-w-0 flex-col gap-2">
          <div id="left">
            <SectionHeader title="What's left" />
          </div>
          <Card className="flex flex-col gap-1 p-1">
            {tools.map((tool) => {
              const nextIn = nextInPools(s.accounts, tool, s.pools, s.now);
              return (
                <div key={tool} className="flex flex-col">
                  <span className="ac-caps px-3 pb-1 pt-3">{TOOL_LABEL[tool]}</span>
                  {rankAccounts(s.accounts, tool, s.now).map((r) => (
                    <CompactAccountRow key={r.account.id} account={r.account} ranked={r} nextIn={nextIn.get(r.account.id)} />
                  ))}
                </div>
              );
            })}
          </Card>
        </section>
      </div>
    </div>
  );
}
