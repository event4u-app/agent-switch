import { useEffect, useState } from "react";
import * as ipc from "../../../ipc.js";
import type { AutoSwitchMap } from "../../../ipc.js";
import { getAutoSwitchGlobal, setAutoSwitchGlobalFlag } from "../../../settings-store.js";
import { fireNearLimitIfCrossed } from "../../engines/near-limit.js";
import type { AutoSwitchTag, ProviderId } from "../../../transforms.js";
import { AccountDot } from "../../../ui/AccountDot.js";
import { Segmented } from "../../../ui/Segmented.js";
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

export const PROTECT_NEW_UNAVAILABLE = "Not adjustable yet — the CLI has no default for new accounts; set each account below.";
export const AUTO_RESUME_UNAVAILABLE = "Needs the protection engine — Agent Switch only warns at the threshold today.";
export const UNKNOWN_USAGE_UNAVAILABLE = "Not adjustable yet — unknown usage is never counted as free, and nothing is paused.";

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
            ? `Warns at ${p.thresholdPct} % of the binding window.`
            : "Off — no warning for this account."
          : "Protection wasn't read (the CLI didn't report it)."
      }
    >
      <div className="w-[120px]">
        <Select
          ariaLabel={`Warn ${label} at`}
          value={String(p?.thresholdPct ?? 98)}
          disabled={!p}
          onChange={(v) => void run(() => fa.setProtection(a.id, { thresholdPct: Number(v) }))}
          options={protectionThresholds(p?.thresholdPct ?? null).map((t) => ({
            value: String(t),
            label: `${t} %`,
            hint: t === 98 ? "Recommended" : undefined,
          }))}
        />
      </div>
      <Switch
        label={`Protect ${label}`}
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
        title="Session protection"
        detail="Warn-only today: at the threshold you get a notice — nothing is paused or switched."
      >
        <SettingRow
          title="Protect new accounts"
          detail={
            <WithReason
              detail="New accounts get the limit warning: a notice at the threshold — nothing is paused or switched. Each account can change this on its own."
              reason={PROTECT_NEW_UNAVAILABLE}
            />
          }
        >
          <Switch label="Protect new accounts" checked={false} disabled onChange={() => {}} />
        </SettingRow>
        {s.accounts.map((a) => (
          <AccountProtectionRow key={a.id} account={a} />
        ))}
        <SettingRow
          title="Continue after the reset"
          detail={
            <WithReason
              detail="Only where the app supports it safely (Claude CLI: native auto-continue). Elsewhere you get a notification."
              reason={AUTO_RESUME_UNAVAILABLE}
            />
          }
        >
          <Switch label="Continue after the reset" checked={false} disabled onChange={() => {}} />
        </SettingRow>
        <SettingRow title="When usage is unknown" detail={<WithReason reason={UNKNOWN_USAGE_UNAVAILABLE} />}>
          <Segmented
            label="When usage is unknown"
            size="sm"
            value=""
            onChange={() => {}}
            options={[
              { value: "warn", label: "Warn me", disabled: true, why: UNKNOWN_USAGE_UNAVAILABLE },
              { value: "pause", label: "Pause", disabled: true, why: UNKNOWN_USAGE_UNAVAILABLE },
            ]}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Near limit">
        <SettingRow
          title="Notify near limit"
          detail="Notify you and suggest the account with the most headroom when one gets near its limit — never switches automatically. Turning this off disables the suggestions below."
        >
          <Switch label="Notify near limit" checked={master} onChange={(v) => void toggleMaster(v)} />
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
                  title={`Notify near limit for ${name}`}
                  detail={
                    can
                      ? "Notify when the active account reaches this usage."
                      : `Needs at least 2 ${name} accounts to suggest between.`
                  }
                >
                  {can && cfg.enabled && (
                    <div className="w-[100px]">
                      <Select
                        ariaLabel={`Near-limit notify threshold for ${name}`}
                        value={String(cfg.threshold)}
                        onChange={(v) =>
                          void writeAuto(pid, cfg.enabled, Number(v), cfg.tag).then((ok) =>
                            ok && cfg.enabled ? fireNearLimitIfCrossed(s.accounts, pid, Number(v), cfg.tag) : false,
                          )
                        }
                        options={NOTIFY_THRESHOLD_CHOICES.map((t) => ({ value: String(t), label: `${t}%` }))}
                      />
                    </div>
                  )}
                  <Switch
                    label={`Notify near limit for ${name}`}
                    checked={cfg.enabled}
                    disabled={!can}
                    onChange={(on) => void writeAuto(pid, on)}
                  />
                </SettingRow>
                {tags && (
                  <SettingRow
                    title={`Suggest for ${name} from`}
                    detail="Which accounts a suggestion may name, by tag. It never changes protection."
                  >
                    <div className="w-[180px]">
                      <Select
                        ariaLabel={`Suggest for ${name} from`}
                        value={cfg.tag}
                        onChange={(v) => void writeAuto(pid, cfg.enabled, cfg.threshold, v as AutoSwitchTag)}
                        options={tags.map((t) => ({ value: t, label: t === "all" ? "All accounts" : `${t} accounts` }))}
                      />
                    </div>
                  </SettingRow>
                )}
              </div>
            );
          })}
      </SettingGroup>
    </>
  );
}
