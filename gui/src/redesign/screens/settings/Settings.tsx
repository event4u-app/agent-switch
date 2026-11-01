import type { ReactNode } from "react";
import { Bell, Box, Cat, Download, KeyRound, Power, Shield, Shuffle, Wrench } from "lucide-react";
import { t, type TKey } from "../../../i18n/index.js";
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

type SettingsGroup = { id: SettingsTab; label: string; icon: typeof Power };

/** `label` is a getter so it reads the live language on every access. */
function group(id: SettingsTab, labelKey: TKey, icon: typeof Power): SettingsGroup {
  return {
    id,
    icon,
    get label() {
      return t(labelKey);
    },
  };
}

/** Settings groups and their order (bundle `Kd`). */
export const SETTINGS_GROUPS: SettingsGroup[] = [
  group("general", "settings.group.general", Power),
  group("sign-ins", "settings.group.signIns", KeyRound),
  group("protection", "settings.group.protection", Shield),
  group("distribution", "settings.group.distribution", Shuffle),
  group("notifications", "settings.group.notifications", Bell),
  group("pet", "settings.group.pet", Cat),
  group("providers", "settings.group.providers", Box),
  group("updates", "settings.group.updates", Download),
  group("advanced", "settings.group.advanced", Wrench),
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
      <PageHeader title={t("settings.shell.title")} />
      <div className="grid gap-6 md:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label={t("settings.shell.groupsNav")} className="flex gap-1 overflow-x-auto md:flex-col">
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
