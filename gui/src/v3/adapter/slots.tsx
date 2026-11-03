/** The pieces of the v3 window that come from elsewhere: the session body
 *  (hosted terminal or the user's own terminal) and the
 *  2.11 settings sections v3 keeps. */

import type { ReactNode } from "react";

import { tauriBackend } from "../../terminal.js";
import type { SessionRow } from "../../transforms.js";
import { AdvancedSettings } from "../../redesign/screens/settings/advanced.js";
import { DistributionSettings } from "../../redesign/screens/settings/distribution.js";
import { GeneralSettings } from "../../redesign/screens/settings/general.js";
import { NotificationSettings } from "../../redesign/screens/settings/notifications.js";
import { PetSettings } from "../../redesign/screens/settings/pet.js";
import { ProtectionSettings } from "../../redesign/screens/settings/protection.js";
import { ProvidersSettings } from "../../redesign/screens/settings/providers.js";
import { SignInSettings } from "../../redesign/screens/settings/sign-ins.js";
import { UpdatesSettings } from "../../redesign/screens/settings/updates.js";
import type { SettingsSection } from "../settings.js";
import { ChatTimeline } from "../chat.js";
import { ExternalBody, HostedTerminal } from "../workbench.js";
import { useTimeline } from "./useTimeline.js";
import { worktreeOf } from "./data.js";

/** The 2.11 settings screens behind the v3 settings nav. Appearance, Open in,
 *  Agents and Remote are v3's own and never reach this function. */
export function settingsSection(section: SettingsSection): ReactNode {
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
export function SessionBody({ sessionKey, row, hosted, vars, followTheme, where, onFocus, onTakeOver, onExit }: { sessionKey: string; row: SessionRow | undefined; hosted: boolean; vars: Record<string, string>; followTheme: boolean; where: string; onFocus: () => void; onTakeOver: () => void; onExit: () => void }) {
  if (hosted) return <HostedTerminal sessionKey={sessionKey} vars={vars} followTheme={followTheme} backend={tauriBackend} onExit={onExit} />;
  const facts = row ? (
    <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1">
      <dt className="text-ac-faint">Folder</dt>
      <dd className="truncate font-ac-mono text-[12px]">{row.cwd ?? "—"}</dd>
      <dt className="text-ac-faint">Branch</dt>
      <dd>{row.git?.branch ?? "—"}</dd>
      <dt className="text-ac-faint">Model</dt>
      <dd>{row.context?.model ?? "—"}</dd>
      <dt className="text-ac-faint">Account</dt>
      <dd>{row.profile}</dd>
    </dl>
  ) : null;
  return <ExternalBody where={row?.surface === "desktop-app" ? "Claude Desktop" : where} facts={facts} lastLine={null} onFocus={onFocus} onTakeOver={onTakeOver} timeline={<ReadOnlyTimeline sessionKey={sessionKey} row={row} />} />;
}

/** The read-only timeline of a session running elsewhere (ADR-010). Falls back
 *  to the facts while it loads or when it cannot be read. */
export function ReadOnlyTimeline({ sessionKey, row }: { sessionKey: string; row?: SessionRow }) {
  const t = useTimeline(sessionKey);
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
  return <ChatTimeline events={t.events} notice={notice} on={{ worktreeOf: worktreeOf(row) }} />;
}
