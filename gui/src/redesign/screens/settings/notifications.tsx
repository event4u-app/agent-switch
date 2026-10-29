import { useEffect, useState } from "react";
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

/** Per-kind alert labels (bundle `$0`); hints follow what the app actually records. */
export const KIND_LABELS: { kind: NotificationKind; label: string; hint: string }[] = [
  { kind: "success", label: "Account switches", hint: "Account switches you made and Codex resets you redeemed." },
  { kind: "warning", label: "Fetch failures", hint: "A usage-limit fetch that did not succeed." },
  { kind: "info", label: "Threshold crossings", hint: "The active account passing a usage threshold." },
  { kind: "error", label: "Errors", hint: "Unexpected failures." },
];

const PERMISSION_LABEL: Record<DesktopPermission, string> = {
  granted: "Granted",
  denied: "Denied",
  default: "Not yet requested",
  unavailable: "Unavailable",
};

export const SESSION_EVENTS_UNAVAILABLE =
  "Not adjustable yet — there is no separate switch for this event; Monitor Claude sessions above covers finished and waiting turns.";

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
          ? "Not available on this platform."
          : "Blocked by the OS — allow notifications for Agent Switch in System Settings.",
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
          title="Desktop notifications"
          detail={
            <>
              Show OS notifications for alerts, including when the app is closed. When off or blocked, alerts still appear
              in the bell and as in-window toasts.
              <span className="mt-1 block">
                OS permission: <span className="text-ac-soft">{perm ? PERMISSION_LABEL[perm] : "…"}</span>
              </span>
              {hint && <span className="mt-1 block text-ac-warn-text">{hint}</span>}
            </>
          }
        >
          <Switch
            label="Desktop notifications"
            checked={!!osNotify}
            disabled={osNotify === null || perm === "unavailable"}
            onChange={(v) => void toggleDesktop(v)}
          />
        </SettingRow>
        <SettingRow
          title="Notify on account switch"
          detail="When you make an account the active one (Use) or turn it off, record a notification — the pet reacts and a desktop alert fires when that is on."
        >
          <Switch label="Notify on account switch" checked={notifyOnSwitch} onChange={setNotifyOnSwitch} />
        </SettingRow>
        <SettingRow
          title="Monitor Claude sessions"
          detail="Watch every Claude session and alert you when Claude finishes a turn or is waiting on you — handy when it runs in a terminal you are not watching. Installs additive, reversible hooks into each Claude account's settings; works while this app is open."
        >
          <Switch label="Monitor Claude sessions" checked={monitoring} onChange={toggleMonitoring} />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Alert types">
        <SettingRow
          title="Context alerts"
          detail={`A session's context window passing a threshold${thresholds.length ? ` (${thresholds.join(" %, ")} %)` : ""}.`}
        >
          <Switch
            label="Context alerts"
            checked={!!contextAlerts}
            disabled={contextAlerts === null}
            onChange={(v) => void toggleContext(v)}
          />
        </SettingRow>
        {KIND_LABELS.map(({ kind, label, hint: kindHint }) => (
          <SettingRow key={kind} title={label} detail={kindHint}>
            <Switch
              label={label}
              checked={!muted.includes(kind)}
              onChange={(on) => setMuted(on ? muted.filter((k) => k !== kind) : [...muted, kind])}
            />
          </SettingRow>
        ))}
      </SettingGroup>

      <SettingGroup title="Sessions and sign-ins">
        {(
          [
            ["A session paused", "Protection stopped it at a safe point."],
            ["A session continued after the reset", undefined],
            ["A session finished", undefined],
            ["A sign-in is needed or looks wrong", undefined],
          ] as const
        ).map(([title, detail]) => (
          <SettingRow key={title} title={title} detail={<WithReason detail={detail} reason={SESSION_EVENTS_UNAVAILABLE} />}>
            <Switch label={title} checked={false} disabled onChange={() => {}} />
          </SettingRow>
        ))}
      </SettingGroup>
    </>
  );
}
