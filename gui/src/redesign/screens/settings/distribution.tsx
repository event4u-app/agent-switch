import { useState } from "react";
import { t, type TKey } from "../../../i18n/index.js";
import * as ipc from "../../../ipc.js";
import { Button } from "../../../ui/Button.js";
import { Segmented } from "../../../ui/Segmented.js";
import { Select } from "../../../ui/Select.js";
import { SettingGroup, SettingRow } from "../../../ui/Setting.js";
import { splitAccountId } from "../../../vm/actions.js";
import { useAS } from "../../../vm/store.js";
import { suggestedPoolTags, useRun } from "./prefs.js";
import { WithReason } from "./shared.js";

/** Keys of the unavailable reasons (translate with `t()` at render). */
export const UNBOUND_UNAVAILABLE = "settings.distribution.unboundUnavailable" satisfies TKey;
export const PER_ACCOUNT_UNAVAILABLE = "settings.distribution.perAccountUnavailable" satisfies TKey;

/** Settings › Distribution (bundle `dR`). */
export function DistributionSettings() {
  const s = useAS();
  const run = useRun();
  const [creating, setCreating] = useState<string | null>(null);
  const suggested = suggestedPoolTags(s.accounts, s.pools);

  async function createFromTag(tag: string) {
    setCreating(tag);
    await run(async () => {
      const pool = await ipc.createPool(tag);
      for (const a of s.accounts.filter((x) => x.label === tag)) {
        const [provider, name] = splitAccountId(a.id);
        await ipc.addPoolMember(pool.id, provider, name);
      }
      s.toast({ text: t("settings.distribution.createdPool", { tag }), tone: "ok" });
    });
    setCreating(null);
    await s.reload();
  }

  return (
    <>
      <SettingGroup>
        <SettingRow
          title={t("settings.distribution.unbound")}
          detail={<WithReason detail={t("settings.distribution.unboundDetail")} reason={t(UNBOUND_UNAVAILABLE)} />}
        >
          <Segmented
            label={t("settings.distribution.unbound")}
            size="sm"
            value="default"
            onChange={() => {}}
            options={[
              { value: "pool", label: t("settings.distribution.mostLeft"), disabled: true, why: t(UNBOUND_UNAVAILABLE) },
              { value: "default", label: t("settings.distribution.defaultAccount") },
              { value: "ask", label: t("settings.distribution.askMe"), disabled: true, why: t(UNBOUND_UNAVAILABLE) },
            ]}
          />
        </SettingRow>
        <SettingRow
          title={t("settings.distribution.perAccount")}
          detail={
            <WithReason
              detail={t("settings.distribution.perAccountDetail")}
              reason={t(PER_ACCOUNT_UNAVAILABLE)}
            />
          }
        >
          <div className="w-[140px]">
            <Select
              ariaLabel={t("settings.distribution.perAccount")}
              value="any"
              disabled
              onChange={() => {}}
              options={[
                { value: "any", label: t("settings.distribution.noLimit") },
                { value: "1", label: "1" },
                { value: "2", label: t("settings.distribution.upTo", { n: 2 }) },
                { value: "3", label: t("settings.distribution.upTo", { n: 3 }) },
                { value: "5", label: t("settings.distribution.upTo", { n: 5 }) },
              ]}
            />
          </div>
        </SettingRow>
        <SettingRow
          title={t("settings.distribution.accountsAndPools")}
          detail={t("settings.distribution.accountsAndPoolsDetail")}
        >
          <Button
            size="sm"
            onClick={() => {
              s.go("accounts");
              s.setAccountsTab("projects");
            }}
          >
            {t("settings.distribution.projectsAndPools")}
          </Button>
        </SettingRow>
      </SettingGroup>
      {suggested.length > 0 && (
        <SettingGroup title={t("settings.distribution.suggested")}>
          {suggested.map((tag) => (
            <SettingRow
              key={tag}
              title={t("settings.distribution.createFromTag", { tag })}
              detail={t("settings.distribution.onlySuggestion")}
            >
              <Button size="sm" disabled={creating !== null} onClick={() => void createFromTag(tag)}>
                {creating === tag ? t("settings.distribution.creating") : t("settings.distribution.createPool")}
              </Button>
            </SettingRow>
          ))}
        </SettingGroup>
      )}
    </>
  );
}
