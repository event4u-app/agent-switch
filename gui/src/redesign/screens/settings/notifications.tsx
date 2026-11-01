import { useEffect, useState } from "react";
import { fmtNumber, t, type TKey } from "../../../i18n/index.js";
import { tx } from "../../../i18n/react.js";
import * as ipc from "../../../ipc.js";
import { desktopPermission, requestDesktopPermission, type DesktopPermission, type NotificationKind } from "../../../notifications.js";
import {
  getMutedKinds,
  getNotifyOnSwitch,
  getSessionMonitoring,
  setMutedKinds,
  setNotifyOnSwitchFlag,
  setSessionMonitoringFlag,
} from "../../../settings-store.js";
import { SettingGroup, SettingRow } from "../../../ui/Setting.js";
import { Switch } from "../../../ui/Switch.js";
import { describeError, usePref, useRun } from "./prefs.js";
import { WithReason } from "./shared.js";

/** Per-kind alert labels (bundle `$0`) as translation keys; hints follow what the app actually records. */
export const KIND_LABELS: { kind: NotificationKind; labelKey: TKey; hintKey: TKey }[] = [
  { kind: "success", labelKey: "settings.notifications.kindSwitches", hintKey: "settings.notifications.kindSwitchesHint" },
  { kind: "warning", labelKey: "settings.notifications.kindFetch", hintKey: "settings.notifications.kindFetchHint" },
  { kind: "info", labelKey: "settings.notifications.kindThreshold", hintKey: "settings.notifications.kindThresholdHint" },
  { kind: "error", labelKey: "settings.notifications.kindErrors", hintKey: "settings.notifications.kindErrorsHint" },
];

const PERMISSION_LABEL: Record<DesktopPermission, TKey> = {
  granted: "settings.notifications.permGranted",
  denied: "settings.notifications.permDenied",
  default: "settings.notifications.permDefault",
  unavailable: "settings.notifications.permUnavailable",
};

/** Key of the reason the per-event switches are unavailable (translate with `t()` at render). */
export const SESSION_EVENTS_UNAVAILABLE = "settings.notifications.sessionEventsUnavailable" satisfies TKey;

const SESSION_EVENTS: readonly (readonly [TKey, TKey | undefined])[] = [
  ["settings.notifications.eventPaused", "settings.notifications.eventPausedDetail"],
  ["settings.notifications.eventContinued", undefined],
  ["settings.notifications.eventFinished", undefined],
  ["settings.notifications.eventSignIn", undefined],
];

function writeSessionMonitoring(on: boolean) {
  setSessionMonitoringFlag(on);
}

/** Settings › Notifications (bundle `fR`, artboard 23). */
export function NotificationSettings() {
  const run = useRun();
  const [perm, setPerm] = useState<DesktopPermission | null>(null);
  const [osNotify, setOsNotifyState] = useState<boolean | null>(null);
  const [contextAlerts, setContextAlerts] = useState<boolean | null>(null);
  const [thresholds, setThresholds] = useState<number[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  const [notifyOnSwitch, setNotifyOnSwitch] = usePref(getNotifyOnSwitch, setNotifyOnSwitchFlag);
  const [monitoring, setMonitoring] = usePref(getSessionMonitoring, writeSessionMonitoring);
  const [muted, setMuted] = usePref<NotificationKind[]>(getMutedKinds, setMutedKinds);

  useEffect(() => {
    desktopPermission()
      .then(setPerm)
      .catch(() => setPerm("unavailable"));
    ipc
      .getOsNotify()
      .then(setOsNotifyState)
      .catch(() => setOsNotifyState(false));
    ipc
      .getNotifyConfig()
      .then((c) => {
        setContextAlerts(c.notify);
        setThresholds(c.contextThresholds);
      })
      .catch(() => setContextAlerts(false));
  }, []);

  // ON asks the OS first and only enables when permission ends up granted;
  // OFF just clears the flag. Optimistic with revert (classic window).
  async function toggleDesktop(next: boolean) {
    setHint(null);
    if (!next) {
      setOsNotifyState(false);
      const ok = await run(async () => (await ipc.setOsNotify(false), true));
      if (!ok) setOsNotifyState(true);
      return;
    }
    let p = perm;
    if (p !== "granted") {
      p = await requestDesktopPermission();
      setPerm(p);
    }
    if (p !== "granted") {
      setHint(
        p === "unavailable"
          ? t("settings.notifications.notOnPlatform")
          : t("settings.notifications.blockedByOs"),
      );
      return;
    }
    setOsNotifyState(true);
    const ok = await run(async () => (await ipc.setOsNotify(true), true));
    if (!ok) setOsNotifyState(false);
  }

  async function toggleContext(next: boolean) {
    try {
      await ipc.setNotify(next, thresholds);
      setContextAlerts(next);
    } catch (e) {
      setHint(describeError(e));
    }
  }

  function toggleMonitoring(on: boolean) {
    setMonitoring(on);
    // Additive, reversible hooks in every Claude account's settings.json.
    void run(() => (on ? ipc.installSessionHooks() : ipc.uninstallSessionHooks()));
  }

  return (
    <>
      <SettingGroup>
        <SettingRow
          title={t("settings.notifications.desktop")}
          detail={
            <>
              {t("settings.notifications.desktopDetail")}
              <span className="mt-1 block">
                {tx("settings.notifications.osPermission", {
                  state: <span className="text-ac-soft">{perm ? t(PERMISSION_LABEL[perm]) : "…"}</span>,
                })}
              </span>
              {hint && <span className="mt-1 block text-ac-warn-text">{hint}</span>}
            </>
          }
        >
          <Switch
            label={t("settings.notifications.desktop")}
            checked={!!osNotify}
            disabled={osNotify === null || perm === "unavailable"}
            onChange={(v) => void toggleDesktop(v)}
          />
        </SettingRow>
        <SettingRow
          title={t("settings.notifications.onSwitch")}
          detail={t("settings.notifications.onSwitchDetail")}
        >
          <Switch label={t("settings.notifications.onSwitch")} checked={notifyOnSwitch} onChange={setNotifyOnSwitch} />
        </SettingRow>
        <SettingRow
          title={t("settings.notifications.monitor")}
          detail={t("settings.notifications.monitorDetail")}
        >
          <Switch label={t("settings.notifications.monitor")} checked={monitoring} onChange={toggleMonitoring} />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title={t("settings.notifications.alertTypes")}>
        <SettingRow
          title={t("settings.notifications.contextAlerts")}
          detail={
            thresholds.length
              ? t("settings.notifications.contextAlertsDetailWith", { list: thresholds.map((n) => `${fmtNumber(n)} %`).join(", ") })
              : t("settings.notifications.contextAlertsDetail")
          }
        >
          <Switch
            label={t("settings.notifications.contextAlerts")}
            checked={!!contextAlerts}
            disabled={contextAlerts === null}
            onChange={(v) => void toggleContext(v)}
          />
        </SettingRow>
        {KIND_LABELS.map(({ kind, labelKey, hintKey }) => (
          <SettingRow key={kind} title={t(labelKey)} detail={t(hintKey)}>
            <Switch
              label={t(labelKey)}
              checked={!muted.includes(kind)}
              onChange={(on) => setMuted(on ? muted.filter((k) => k !== kind) : [...muted, kind])}
            />
          </SettingRow>
        ))}
      </SettingGroup>

      <SettingGroup title={t("settings.notifications.sessionsAndSignIns")}>
        {SESSION_EVENTS.map(([titleKey, detailKey]) => (
          <SettingRow
            key={titleKey}
            title={t(titleKey)}
            detail={<WithReason detail={detailKey && t(detailKey)} reason={t(SESSION_EVENTS_UNAVAILABLE)} />}
          >
            <Switch label={t(titleKey)} checked={false} disabled onChange={() => {}} />
          </SettingRow>
        ))}
      </SettingGroup>
    </>
  );
}
