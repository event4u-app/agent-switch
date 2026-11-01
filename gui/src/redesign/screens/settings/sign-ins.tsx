import { useEffect, useState } from "react";
import { t, tp, type TKey } from "../../../i18n/index.js";
import * as ipc from "../../../ipc.js";
import { Card } from "../../../ui/Card.js";
import { Select } from "../../../ui/Select.js";
import { SettingGroup, SettingRow } from "../../../ui/Setting.js";
import { Switch } from "../../../ui/Switch.js";
import { useRun } from "./prefs.js";
import { WithReason } from "./shared.js";

/** Key of the reason the reminder is unavailable (translate with `t()` at render). */
export const REMIND_UNAVAILABLE = "settings.signIns.remindUnavailable" satisfies TKey;

/** Settings › Sign-ins (bundle `cR`, artboard 12). "Keep accounts signed in"
 *  is the CLI's `keep-signed-in`; the reminder has no backend yet and renders
 *  disabled with the reason. */
export function SignInSettings() {
  const run = useRun();
  // null until read: the switch stays disabled rather than showing a guess.
  const [keep, setKeep] = useState<boolean | null>(null);
  useEffect(() => {
    ipc
      .getKeepSignedIn()
      .then(setKeep)
      .catch(() => setKeep(null));
  }, []);

  async function toggleKeep(next: boolean) {
    setKeep(next);
    const ok = await run(async () => (await ipc.setKeepSignedIn(next), true));
    if (!ok) setKeep(!next);
  }

  return (
    <>
      <SettingGroup>
        <SettingRow
          title={t("settings.signIns.keep")}
          detail={
            <>
              {t("settings.signIns.keepDetail")}
              <span className="mt-1 block text-ac-faint">{t("settings.signIns.keepNotCovered")}</span>
            </>
          }
        >
          <Switch
            label={t("settings.signIns.keep")}
            checked={keep ?? false}
            disabled={keep === null}
            onChange={(v) => void toggleKeep(v)}
          />
        </SettingRow>
        <SettingRow
          title={t("settings.signIns.remind")}
          detail={
            <WithReason
              detail={t("settings.signIns.remindDetail")}
              reason={t(REMIND_UNAVAILABLE)}
            />
          }
        >
          <div className="w-[160px]">
            <Select
              ariaLabel={t("settings.signIns.remind")}
              value="5"
              disabled
              onChange={() => {}}
              options={[
                { value: "3", label: tp("settings.signIns.daysBefore", 3) },
                { value: "5", label: tp("settings.signIns.daysBefore", 5), hint: t("settings.signIns.likeClaudeCode") },
                { value: "7", label: tp("settings.signIns.daysBefore", 7) },
              ]}
            />
          </div>
        </SettingRow>
      </SettingGroup>
      <Card className="flex flex-col gap-2 p-4">
        <p className="text-[13px] text-ac-text">{t("settings.signIns.cantPrevent")}</p>
        <p className="text-xs text-ac-muted">{t("settings.signIns.cantPreventDetail")}</p>
      </Card>
    </>
  );
}
