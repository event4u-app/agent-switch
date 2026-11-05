/** The pieces of the v3 window that come from elsewhere: the session body
 *  (hosted terminal or the user's own terminal) and the
 *  2.11 settings sections v3 keeps. */

import { useMemo, useState, type ReactNode } from "react";

import { tauriBackend } from "../../terminal.js";
import type { SessionRow } from "../../transforms.js";
import { AdvancedSettings } from "../../redesign/screens/settings/advanced.js";
import { ClaudeSettings } from "../../redesign/screens/settings/claude.js";
import { DistributionSettings } from "../../redesign/screens/settings/distribution.js";
import { GeneralSettings } from "../../redesign/screens/settings/general.js";
import { NotificationSettings } from "../../redesign/screens/settings/notifications.js";
import { PetSettings } from "../../redesign/screens/settings/pet.js";
import { ProtectionSettings } from "../../redesign/screens/settings/protection.js";
import { ProvidersSettings } from "../../redesign/screens/settings/providers.js";
import { SignInSettings } from "../../redesign/screens/settings/sign-ins.js";
import { UpdatesSettings } from "../../redesign/screens/settings/updates.js";
import type { SettingsSection } from "../settings.js";
import { ChatTimeline, hiddenText } from "../chat.js";
import { TranscriptTerminal } from "../transcript-terminal.js";
import { fold } from "../timeline.js";
import { ExternalBody, HostedTerminal } from "../workbench.js";
import { useTimeline, type TimelineState } from "./useTimeline.js";
import { worktreeOf } from "./data.js";
import { modelLabel } from "../model-label.js";
import { AgentConfigCard, INSTALLABLE_TOOLS, NoAgentConfigCard, agentConfigMissing, forgetFailedReleaseLookups, isolatedLabel, sortTools, useAgentConfigLatest } from "../../redesign/screens/tools.js";
import { useAS } from "../../vm/store.js";
import { toolStatus } from "../../vm/rules.js";
import { ToolsPage, type ToolRowView } from "../tools.js";

/** The 2.11 settings screens behind the v3 settings nav. Appearance, Open in,
 *  Agents and Remote are v3's own and never reach this function. */
export function settingsSection(section: SettingsSection): ReactNode {
  const screen = legacyScreen(section);
  // The 2.11 screens leave their spacing to the parent column, as in 2.11's Settings.
  return screen && <div className="flex min-w-0 flex-col gap-5">{screen}</div>;
}

function legacyScreen(section: SettingsSection): ReactNode {
  switch (section) {
    case "General":
      return <GeneralSettings />;
    case "Sign-ins":
      return <SignInSettings />;
    case "Protection":
      return <ProtectionSettings />;
    case "Distribution":
      return <DistributionSettings />;
    case "Notifications":
      return <NotificationSettings />;
    case "Desktop pet":
      return <PetSettings />;
    case "Providers":
      return <ProvidersSettings />;
    case "Claude Code":
      return <ClaudeSettings />;
    case "Updates":
      return <UpdatesSettings />;
    case "Advanced":
      return <AdvancedSettings />;
    case "Appearance":
    case "Open in":
    case "Agents":
    case "Remote":
      return null;
  }
}

/** The session body: Agent Switch's own terminal for a hosted session, the
 *  facts and a focus button for one in the user's terminal (D-mirror). */
export function SessionBody({ sessionKey, row, hosted, ownView = "chat", vars, followTheme, where, onFocus, onTakeOver, onExit }: { sessionKey: string; row: SessionRow | undefined; hosted: boolean; ownView?: "terminal" | "chat"; vars: Record<string, string>; followTheme: boolean; where: string; onFocus: () => void; onTakeOver: () => void; onExit: () => void }) {
  if (hosted) return <HostedTerminal sessionKey={sessionKey} vars={vars} followTheme={followTheme} backend={tauriBackend} onExit={onExit} />;
  const facts = row ? (
    <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1">
      <dt className="text-ac-faint">Folder</dt>
      <dd className="truncate font-ac-mono text-[12px]">{row.cwd ?? ""}</dd>
      <dt className="text-ac-faint">Branch</dt>
      <dd>{row.git?.branch ?? ""}</dd>
      <dt className="text-ac-faint">Model</dt>
      <dd title={row.context?.model ?? undefined}>{modelLabel(row.context?.model) ?? ""}</dd>
      <dt className="text-ac-faint">Account</dt>
      <dd>{row.profile}</dd>
    </dl>
  ) : null;
  return <ExternalSession sessionKey={sessionKey} row={row} view={ownView} where={row?.surface === "desktop-app" ? "Claude Desktop" : where} facts={facts} onFocus={onFocus} onTakeOver={onTakeOver} />;
}

/** One read of the transcript feeds the timeline and the "read-only here"
 *  tooltip, which carries the count of lines not drawn (gap §5e). */
function ExternalSession({ sessionKey, row, view, where, facts, onFocus, onTakeOver }: { sessionKey: string; row: SessionRow | undefined; view: "terminal" | "chat"; where: string; facts: ReactNode; onFocus: () => void; onTakeOver: () => void }) {
  const t = useTimeline(sessionKey);
  const hidden = useMemo(() => hiddenText(fold(t.events).hidden), [t.events]);
  return <ExternalBody where={where} facts={facts} lastLine={null} onFocus={onFocus} onTakeOver={onTakeOver} readOnlyTitle={hidden} timeline={<ReadOnlyTimeline t={t} row={row} terminal={view === "terminal"} />} />;
}

/** The read-only timeline of a session running elsewhere (ADR-010). Falls back
 *  to the facts while it loads or when it cannot be read. */
export function ReadOnlyTimeline({ t, row, terminal }: { t: TimelineState; row?: SessionRow; terminal?: boolean }) {
  if (!t.loaded) return <p className="m-auto text-[13px] text-ac-muted">Reading the conversation…</p>;
  const notice = t.error ? (
    <p role="status" className="shrink-0 border-b border-ac-line bg-ac-warn-tint px-4 py-1.5 text-xs text-ac-warn-text">
      The conversation could not be read: {t.error}
    </p>
  ) : t.newerThanFixtures ? (
    <p role="status" className="shrink-0 border-b border-ac-line bg-ac-info-tint px-4 py-1.5 text-xs text-ac-info-text">
      Claude Code {t.version} is newer than the versions Agent Switch was tested with — some steps may show as not shown. Focus the terminal to see everything.
    </p>
  ) : null;
  if (terminal)
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {notice}
        <TranscriptTerminal events={t.events} />
      </div>
    );
  return <ChatTimeline events={t.events} notice={notice} on={{ worktreeOf: worktreeOf(row) }} />;
}

/** Tools on the store: the board's rows, then the 2.11 agent-config card
 *  (spec §11). agent-config's latest comes from its releases, as in 2.11. */
export function ToolsSlot() {
  const s = useAS();
  const [checking, setChecking] = useState(false);
  useAgentConfigLatest(s);
  const rows: ToolRowView[] = sortTools(s.tools).map((t) => ({
    id: t.id,
    name: t.name,
    where: [t.present ? t.path : null, isolatedLabel(t.id, s.accounts)].filter(Boolean).join(" · ") || null,
    version: t.present ? t.version : null,
    status: toolStatus(t),
    latest: t.latest,
  }));
  const terminal = (toolId: string, action: "install" | "update") => INSTALLABLE_TOOLS.has(toolId) && s.open({ kind: "terminal", toolId, action });
  return (
    <ToolsPage
      rows={rows}
      checking={checking}
      on={{
        check: () => {
          forgetFailedReleaseLookups();
          setChecking(true);
          void Promise.resolve(s.act.recheckTools?.()).finally(() => setChecking(false));
        },
        update: (id) => terminal(id, "update"),
        install: (id) => terminal(id, "install"),
      }}
      below={agentConfigMissing(s) ? <NoAgentConfigCard /> : <AgentConfigCard />}
    />
  );
}
