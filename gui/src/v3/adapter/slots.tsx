/** The pieces of the v3 window that come from elsewhere: the session body
 *  (hosted terminal or the user's own terminal), the Open ▾ menu, and the
 *  2.11 settings sections v3 keeps. */

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

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
import { Act } from "../kit.js";
import type { OpenTarget, SettingsSection } from "../settings.js";
import { ExternalBody, HostedTerminal } from "../workbench.js";

/** The 2.11 settings screens behind the v3 settings nav. Appearance and Open in
 *  are v3's own and never reach this function. */
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
      return null;
  }
}

/** Open ▾ for one session: the installed targets, the default first. */
export function OpenInMenu({ targets, defaultTarget, onOpen }: { targets: OpenTarget[]; defaultTarget: string | null; onOpen: (target: string) => void }) {
  const [open, setOpen] = useState(false);
  const usable = targets.filter((t) => t.installed && t.kind !== "agent-app");
  if (!usable.length) return null;
  const ordered = [...usable].sort((a, b) => Number(b.target === defaultTarget) - Number(a.target === defaultTarget));
  return (
    <div className="relative shrink-0">
      <Act onClick={() => setOpen((v) => !v)} title="Open this session's worktree">
        Open <ChevronDown className="size-3.5" />
      </Act>
      {open && (
        <div role="menu" aria-label="Open in" className="absolute right-0 top-8 z-20 w-[200px] rounded-xl border border-ac-line2 bg-ac-panel p-1" style={{ boxShadow: "var(--ac-shadow)" }}>
          {ordered.map((t) => (
            <button
              key={t.target}
              type="button"
              role="menuitem"
              onClick={() => (setOpen(false), onOpen(t.target))}
              className="flex h-8 w-full items-center justify-between rounded-md px-2.5 text-left text-[13px] text-ac-soft hover:bg-ac-raise"
            >
              {t.label}
              {t.target === defaultTarget && <span className="text-[11px] text-ac-faint">default</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
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
  return <ExternalBody where={row?.surface === "desktop-app" ? "Claude Desktop" : where} facts={facts} lastLine={null} onFocus={onFocus} onTakeOver={onTakeOver} />;
}
