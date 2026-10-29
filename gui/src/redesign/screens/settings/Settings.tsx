import type { ReactNode } from "react";
import { Bell, Box, Cat, Download, KeyRound, Power, Shield, Shuffle, Wrench } from "lucide-react";
import { cn } from "../../../lib/utils.js";
import { Caps, PageHeader } from "../../../ui/Typography.js";
import { useAS, type SettingsTab } from "../../../vm/store.js";
import { AdvancedSettings } from "./advanced.js";
import { DistributionSettings } from "./distribution.js";
import { GeneralSettings } from "./general.js";
import { NotificationSettings } from "./notifications.js";
import { PetSettings } from "./pet.js";
import { ProtectionSettings } from "./protection.js";
import { ProvidersSettings } from "./providers.js";
import { SignInSettings } from "./sign-ins.js";
import { UpdatesSettings } from "./updates.js";

/** Settings groups and their order (bundle `Kd`). */
export const SETTINGS_GROUPS: { id: SettingsTab; label: string; icon: typeof Power }[] = [
  { id: "general", label: "General", icon: Power },
  { id: "sign-ins", label: "Sign-ins", icon: KeyRound },
  { id: "protection", label: "Protection", icon: Shield },
  { id: "distribution", label: "Distribution", icon: Shuffle },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "pet", label: "Desktop pet", icon: Cat },
  { id: "providers", label: "Providers", icon: Box },
  { id: "updates", label: "Updates", icon: Download },
  { id: "advanced", label: "Advanced", icon: Wrench },
];

const PAGES: Record<SettingsTab, () => ReactNode> = {
  general: () => <GeneralSettings />,
  "sign-ins": () => <SignInSettings />,
  protection: () => <ProtectionSettings />,
  distribution: () => <DistributionSettings />,
  notifications: () => <NotificationSettings />,
  pet: () => <PetSettings />,
  providers: () => <ProvidersSettings />,
  updates: () => <UpdatesSettings />,
  advanced: () => <AdvancedSettings />,
};

/** Settings screen: 200 px group nav left, the selected group right (bundle `iR`). */
export function Settings() {
  const s = useAS();
  const tab = SETTINGS_GROUPS.some((g) => g.id === s.settingsTab) ? s.settingsTab : "general";
  const current = SETTINGS_GROUPS.find((g) => g.id === tab)!;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="How should it behave?" />
      <div className="grid gap-6 md:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label="Settings groups" className="flex gap-1 overflow-x-auto md:flex-col">
          {SETTINGS_GROUPS.map(({ id, label, icon: Icon }) => {
            const active = id === tab;
            return (
              <button
                key={id}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => s.go("settings", id)}
                className={cn(
                  "inline-flex h-9 shrink-0 items-center gap-2.5 whitespace-nowrap rounded-md px-3 text-[13px] transition-colors",
                  active
                    ? "bg-ac-brand-tint text-ac-text shadow-[inset_0_0_0_1px_var(--ac-brand-line)]"
                    : "text-ac-muted hover:bg-ac-raise hover:text-ac-text",
                )}
              >
                <Icon className={cn("size-4", active && "text-ac-brand-text")} />
                {label}
              </button>
            );
          })}
        </nav>
        <div className="flex min-w-0 flex-col gap-5">
          <Caps>{current.label}</Caps>
          {PAGES[tab]()}
        </div>
      </div>
    </div>
  );
}
