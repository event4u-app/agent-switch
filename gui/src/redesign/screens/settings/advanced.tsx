import { useState } from "react";
import { Trash2, TriangleAlert } from "lucide-react";
import { t, type TKey } from "../../../i18n/index.js";
import { tx } from "../../../i18n/react.js";
import { Button } from "../../../ui/Button.js";
import { Segmented } from "../../../ui/Segmented.js";
import { SettingGroup, SettingRow } from "../../../ui/Setting.js";
import { TextInput } from "../../../ui/TextInput.js";
import { useAS } from "../../../vm/store.js";
import { getUiWindow, setUiWindow, type UiWindow } from "../../../settings-store.js";
import type { GuardPolicy } from "../../../vm/types.js";
import { uninstallArmed, useFoundation, useRun } from "./prefs.js";
import { WithReason } from "./shared.js";

/** Key of the reason the diagnostics export is unavailable (translate with `t()` at render). */
export const DIAGNOSTICS_UNAVAILABLE = "settings.advanced.diagnosticsUnavailable" satisfies TKey;

/** The word the user types to arm uninstall (see `uninstallArmed`); never translated. */
const UNINSTALL_WORD = "uninstall";

/** Settings › Advanced (bundle `xR`, artboard 26). */
export function AdvancedSettings() {
  const s = useAS();
  const fa = useFoundation();
  const run = useRun();
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const armed = uninstallArmed(confirm);

  async function uninstall() {
    if (!s.act.uninstall) return;
    setBusy(true);
    const ok = await run(async () => (await s.act.uninstall!(), true));
    if (ok) await run(async () => s.act.quit?.());
    setBusy(false);
  }

  return (
    <>
      <SettingGroup>
        <SettingRow title={t("settings.advanced.window")} detail={t("settings.advanced.windowDetail")}>
          <Segmented<UiWindow>
            label={t("settings.advanced.window")}
            size="sm"
            value={getUiWindow()}
            onChange={(w) => {
              setUiWindow(w);
              location.reload();
            }}
            options={[
              { value: "v3", label: t("settings.advanced.windowV3") },
              { value: "2.11", label: t("settings.advanced.windowPrevious") },
            ]}
          />
        </SettingRow>
        <SettingRow
          title={t("settings.advanced.sameAccount")}
          detail={
            s.guard.policy
              ? t("settings.advanced.sameAccountDetail")
              : <WithReason detail={t("settings.advanced.sameAccountDetail")} reason={t("settings.advanced.policyNotRead")} />
          }
        >
          <Segmented<GuardPolicy>
            label={t("settings.advanced.sameAccount")}
            size="sm"
            value={(s.guard.policy ?? "") as GuardPolicy}
            onChange={(p) => void run(() => fa.setGuard(p))}
            options={[
              { value: "warn", label: t("settings.advanced.warn") },
              { value: "block", label: t("settings.advanced.block") },
              { value: "off", label: t("common.off") },
            ]}
          />
        </SettingRow>
        <SettingRow
          title={t("settings.advanced.diagnostics")}
          detail={
            <WithReason
              detail={t("settings.advanced.diagnosticsDetail")}
              reason={t(DIAGNOSTICS_UNAVAILABLE)}
            />
          }
        >
          <Button size="sm" disabled title={t(DIAGNOSTICS_UNAVAILABLE)}>
            {t("settings.advanced.export")}
          </Button>
        </SettingRow>
      </SettingGroup>
      <SettingGroup title={t("settings.advanced.dangerZone")}>
        <SettingRow
          tone="danger"
          stacked
          title={
            <span className="flex items-center gap-1.5">
              <TriangleAlert className="size-4" /> {t("settings.advanced.uninstall")}
            </span>
          }
          detail={
            tx("settings.advanced.uninstallDetail", {
              all: <strong className="text-ac-soft">{t("settings.advanced.uninstallAll")}</strong>,
              path: <span className="font-ac-mono">~/.agent-switch</span>,
            })
          }
        >
          <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-xs text-ac-muted">
            <span>
              {tx("settings.advanced.typeToConfirm", { word: <span className="font-ac-mono text-ac-text">{UNINSTALL_WORD}</span> })}
            </span>
            <TextInput mono placeholder={UNINSTALL_WORD} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </label>
          <Button
            size="sm"
            variant="danger"
            disabled={!armed || busy || !s.act.uninstall}
            onClick={() => void uninstall()}
            className="self-end"
          >
            <Trash2 /> {t("settings.advanced.uninstall")}
          </Button>
        </SettingRow>
      </SettingGroup>
    </>
  );
}
