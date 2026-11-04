import { useEffect, useState } from "react";
import { tagLabel } from "../account-logic.js";
import { t, type TKey } from "../../../i18n/index.js";
import * as ipc from "../../../ipc.js";
import type { AutoSwitchMap } from "../../../ipc.js";
import { getAutoSwitchGlobal, getLimitAutoOpen, setAutoSwitchGlobalFlag, setLimitAutoOpen } from "../../../settings-store.js";
import { fireNearLimitIfCrossed } from "../../engines/near-limit.js";
import type { AutoSwitchTag, ProviderId } from "../../../transforms.js";
import { AccountDot } from "../../../ui/AccountDot.js";
import { Select } from "../../../ui/Select.js";
import { SettingGroup, SettingRow } from "../../../ui/Setting.js";
import { Switch } from "../../../ui/Switch.js";
import { TOOL_LABEL } from "../../../vm/rules.js";
import { useAS } from "../../../vm/store.js";
import type { Account } from "../../../vm/types.js";
import {
  NEAR_LIMIT_PROVIDERS,
  NOTIFY_THRESHOLD_CHOICES,
  protectionThresholds,
  providersToDisable,
  scopeTags,
  useFoundation,
  useRun,
} from "./prefs.js";
import { WithReason } from "./shared.js";

/** Keys of the unavailable reasons (translate with `t()` at render). */
export const PROTECT_NEW_UNAVAILABLE = "settings.protection.newUnavailable" satisfies TKey;
export const AUTO_RESUME_UNAVAILABLE = "settings.protection.autoResumeUnavailable" satisfies TKey;
export const UNKNOWN_USAGE_UNAVAILABLE = "settings.protection.unknownUsageUnavailable" satisfies TKey;

function AccountProtectionRow({ account: a }: { account: Account }) {
  const fa = useFoundation();
  const run = useRun();
  const p = a.protection;
  const label = `${TOOL_LABEL[a.tool]} · ${a.name}`;
  return (
    <SettingRow
      title={
        <span className="flex items-center gap-2">
          <AccountDot color={a.color} />
          {label}
        </span>
      }
      detail={
        p
          ? p.enabled
            ? t("settings.protection.warnsAt", { pct: p.thresholdPct })
            : t("settings.protection.accountOff")
          : t("settings.protection.notRead")
      }
    >
      <div className="w-[120px]">
        <Select
          ariaLabel={t("settings.protection.warnAt", { name: label })}
          value={String(p?.thresholdPct ?? 98)}
          disabled={!p}
          onChange={(v) => void run(() => fa.setProtection(a.id, { thresholdPct: Number(v) }))}
          options={protectionThresholds(p?.thresholdPct ?? null).map((pct) => ({
            value: String(pct),
            label: `${pct} %`,
            hint: pct === 98 ? t("settings.protection.recommended") : undefined,
          }))}
        />
      </div>
      <Switch
        label={t("settings.protection.protectAccount", { name: label })}
        checked={!!p?.enabled}
        disabled={!p}
        onChange={(on) => void run(() => fa.setProtection(a.id, { enabled: on }))}
      />
    </SettingRow>
  );
}

/** Settings › Protection (bundle `uR`). Shows what exists: the per-account
 *  limit warning (`protection`) and near-limit notifications (`autoswitch`). */
export function ProtectionSettings() {
  const s = useAS();
  const run = useRun();
  const [auto, setAuto] = useState<AutoSwitchMap | null>(null);
  const [master, setMaster] = useState(getAutoSwitchGlobal);

  const readAuto = () =>
    ipc
      .getAutoSwitch()
      .then(setAuto)
      .catch(() => setAuto(null));
  useEffect(() => {
    void readAuto();
  }, []);

  /** True when the CLI took the write (a failure is toasted by `run`). */
  async function writeAuto(pid: ProviderId, enabled: boolean, threshold?: number, tag?: AutoSwitchTag): Promise<boolean> {
    const ok = await run(async () => {
      await ipc.setAutoSwitch(pid, enabled, threshold, tag);
      return true;
    });
    await readAuto();
    return ok === true;
  }

  async function toggleMaster(on: boolean) {
    setAutoSwitchGlobalFlag(on);
    setMaster(on);
    // Off switches every provider off — nothing may notify behind a disabled
    // master. On only re-exposes the per-provider toggles.
    if (!on) {
      await run(() => Promise.all(providersToDisable(auto).map((p) => ipc.setAutoSwitch(p, false))));
      await readAuto();
    }
  }

  return (
    <>
      <SettingGroup
        title={t("settings.protection.session")}
        detail={t("settings.protection.sessionDetail")}
      >
        <SettingRow
          title={t("settings.protection.protectNew")}
          detail={
            <WithReason
              detail={t("settings.protection.protectNewDetail")}
              reason={t(PROTECT_NEW_UNAVAILABLE)}
            />
          }
        >
          <Switch label={t("settings.protection.protectNew")} checked disabled onChange={() => {}} />
        </SettingRow>
        {s.accounts.map((a) => (
          <AccountProtectionRow key={a.id} account={a} />
        ))}
        <SettingRow
          title={t("settings.protection.continueAfterReset")}
          detail={
            <WithReason
              detail={t("settings.protection.continueAfterResetDetail")}
              reason={t(AUTO_RESUME_UNAVAILABLE)}
            />
          }
        >
          <Switch label={t("settings.protection.continueAfterReset")} checked={false} disabled onChange={() => {}} />
        </SettingRow>
        {/* No option is in force yet, so this is a statement, not a choice. */}
        <SettingRow title={t("settings.protection.unknownUsage")} detail={t(UNKNOWN_USAGE_UNAVAILABLE)} />
      </SettingGroup>

      <SettingGroup title={t("settings.protection.nearLimit")}>
        <SettingRow
          title={t("settings.protection.notifyNearLimit")}
          detail={t("settings.protection.notifyNearLimitDetail")}
        >
          <Switch label={t("settings.protection.notifyNearLimit")} checked={master} onChange={(v) => void toggleMaster(v)} />
        </SettingRow>
        {master &&
          auto &&
          NEAR_LIMIT_PROVIDERS.filter((pid) => auto[pid]).map((pid) => {
            const cfg = auto[pid];
            const name = TOOL_LABEL[pid];
            const count = s.accounts.filter((a) => a.tool === pid).length;
            const can = count >= 2;
            const tags = scopeTags(s.accounts, pid);
            return (
              <div key={pid} className="flex flex-col divide-y divide-ac-line">
                <SettingRow
                  title={t("settings.protection.notifyNearLimitFor", { name })}
                  detail={can ? t("settings.protection.notifyAtUsage") : t("settings.protection.needsTwo", { name })}
                >
                  {can && cfg.enabled && (
                    <div className="w-[100px]">
                      <Select
                        ariaLabel={t("settings.protection.thresholdFor", { name })}
                        value={String(cfg.threshold)}
                        onChange={(v) =>
                          void writeAuto(pid, cfg.enabled, Number(v), cfg.tag).then((ok) =>
                            ok && cfg.enabled ? fireNearLimitIfCrossed(s.accounts, pid, Number(v), cfg.tag) : false,
                          )
                        }
                        options={NOTIFY_THRESHOLD_CHOICES.map((pct) => ({ value: String(pct), label: `${pct}%` }))}
                      />
                    </div>
                  )}
                  <Switch
                    label={t("settings.protection.notifyNearLimitFor", { name })}
                    checked={cfg.enabled}
                    disabled={!can}
                    onChange={(on) => void writeAuto(pid, on)}
                  />
                </SettingRow>
                {tags && (
                  <SettingRow
                    title={t("settings.protection.suggestFrom", { name })}
                    detail={t("settings.protection.suggestFromDetail")}
                  >
                    <div className="w-[180px]">
                      <Select
                        ariaLabel={t("settings.protection.suggestFrom", { name })}
                        value={cfg.tag}
                        onChange={(v) => void writeAuto(pid, cfg.enabled, cfg.threshold, v as AutoSwitchTag)}
                        options={tags.map((tag) => ({
                          value: tag,
                          label: tag === "all" ? t("settings.protection.allAccounts") : t("settings.protection.tagAccounts", { tag: tagLabel(tag) }),
                        }))}
                      />
                    </div>
                  </SettingRow>
                )}
              </div>
            );
          })}
      </SettingGroup>
      <StartStrategyGroup />
      <LimitAutoOpenGroup />
      <CodexAutoResetGroup />
    </>
  );
}

/** "Ask me when a session reaches its limit" — opens the decision sheet by itself. */
function LimitAutoOpenGroup() {
  const [on, setOn] = useState(getLimitAutoOpen);
  return (
    <SettingGroup title={t("settings.protection.atTheLimit")}>
      <SettingRow title={t("settings.protection.limitAutoOpen")} detail={t("settings.protection.limitAutoOpenDetail")}>
        <Switch
          label={t("settings.protection.limitAutoOpen")}
          checked={on}
          onChange={(v) => {
            setLimitAutoOpen(v);
            setOn(v);
          }}
        />
      </SettingRow>
    </SettingGroup>
  );
}

const STRATEGY_TOOLS: ProviderId[] = ["claude", "codex"];

/** "New sessions" — the CLI's `strategy`, per tool. */
function StartStrategyGroup() {
  const run = useRun();
  const [values, setValues] = useState<Partial<Record<ProviderId, ipc.StartStrategy>>>({});
  useEffect(() => {
    for (const p of STRATEGY_TOOLS) {
      ipc
        .getStrategy(p)
        .then((v) => setValues((cur) => ({ ...cur, [p]: v })))
        .catch(() => {});
    }
  }, []);

  async function change(p: ProviderId, next: ipc.StartStrategy) {
    const prev = values[p];
    setValues((cur) => ({ ...cur, [p]: next }));
    const ok = await run(async () => (await ipc.setStrategy(p, next), true));
    if (!ok) setValues((cur) => ({ ...cur, [p]: prev }));
  }

  return (
    <SettingGroup title={t("settings.protection.newSessions")} detail={t("settings.protection.newSessionsDetail")}>
      {STRATEGY_TOOLS.map((p) => {
        const name = TOOL_LABEL[p];
        return (
          <SettingRow key={p} title={t("settings.protection.strategyFor", { name })}>
            <div className="w-[220px]">
              <Select
                ariaLabel={t("settings.protection.strategyFor", { name })}
                value={values[p] ?? "balance"}
                disabled={values[p] === undefined}
                onChange={(v) => void change(p, v as ipc.StartStrategy)}
                options={[
                  { value: "balance", label: t("settings.protection.strategyBalance"), hint: t("settings.protection.strategyBalanceHint") },
                  { value: "fill", label: t("settings.protection.strategyFill"), hint: t("settings.protection.strategyFillHint") },
                ]}
              />
            </div>
          </SettingRow>
        );
      })}
    </SettingGroup>
  );
}

/** "Redeem Codex resets automatically" — the CLI's `auto-reset`. Off by
 *  default: a banked reset is scarce and cannot be returned. */
function CodexAutoResetGroup() {
  const run = useRun();
  // null until read: the switch stays disabled rather than showing a guess.
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    ipc
      .getCodexAutoReset()
      .then(setOn)
      .catch(() => setOn(null));
  }, []);

  async function toggle(next: boolean) {
    setOn(next);
    const ok = await run(async () => (await ipc.setCodexAutoReset(next), true));
    if (!ok) setOn(!next);
  }

  return (
    <SettingGroup title={t("settings.protection.codexResets")}>
      <SettingRow title={t("settings.protection.autoReset")} detail={t("settings.protection.autoResetDetail")}>
        <Switch label={t("settings.protection.autoReset")} checked={on ?? false} disabled={on === null} onChange={(v) => void toggle(v)} />
      </SettingRow>
    </SettingGroup>
  );
}
