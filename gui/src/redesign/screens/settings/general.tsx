import { useState } from "react";
import { LogOut } from "lucide-react";
import * as ipc from "../../../ipc.js";
import {
  getAutoRefreshLimits,
  getDevMode,
  getMinimizeToDock,
  getRefreshMinutes,
  REFRESH_INTERVAL_CHOICES,
  setAutoRefreshLimitsFlag,
  setDevModeFlag,
  setHideSummariesFlag,
  setMinimizeToDockFlag,
  setNextUsageRefreshAt,
  setRefreshMinutes,
} from "../../../settings-store.js";
import { applyTheme, getTheme, type Theme } from "../../../theme.js";
import { Badge } from "../../../ui/Badge.js";
import { Button } from "../../../ui/Button.js";
import { Segmented } from "../../../ui/Segmented.js";
import { Select } from "../../../ui/Select.js";
import { SettingGroup, SettingRow } from "../../../ui/Setting.js";
import { Switch } from "../../../ui/Switch.js";
import { useAS } from "../../../vm/store.js";
import { usePref, useRun } from "./prefs.js";
import { WithReason } from "./shared.js";

const IS_DEV = import.meta.env.DEV;

function writeMinimizeToDock(on: boolean) {
  setMinimizeToDockFlag(on);
  void ipc.setMinimizeToDock(on).catch(() => {}); // keep the Rust window-event handler in sync
}

function writeAutoRefresh(on: boolean) {
  setAutoRefreshLimitsFlag(on);
  // Restart the countdown so the toggle takes effect from now (classic window).
  if (on) setNextUsageRefreshAt(Date.now() + getRefreshMinutes() * 60_000);
}

/** Settings › General (bundle `lR`, artboard 27). */
export function GeneralSettings() {
  const s = useAS();
  const run = useRun();
  const [autostart, setAutostartState] = useState<boolean | null>(() =>
    s.autostart.actual == null ? null : s.autostart.actual === "enabled",
  );
  const [autostartFailed, setAutostartFailed] = useState(false);
  const [minimizeToDock, setMinimizeToDock] = usePref(getMinimizeToDock, writeMinimizeToDock);
  const [theme, setTheme] = usePref<Theme>(getTheme, applyTheme);
  const [autoRefresh, setAutoRefresh] = usePref(getAutoRefreshLimits, writeAutoRefresh);
  const [refreshMinutes, setRefresh] = usePref(getRefreshMinutes, setRefreshMinutes);
  const [devMode, setDevMode] = usePref(() => IS_DEV && getDevMode(), setDevModeFlag);
  const on = autostart ?? false;

  async function toggleAutostart(next: boolean) {
    setAutostartState(next);
    setAutostartFailed(false);
    const ok = await run(async () => {
      if (!s.act.setAutostart) throw new Error("Start at login is not available.");
      await s.act.setAutostart(next);
      return true;
    });
    if (!ok) {
      setAutostartState(!next);
      setAutostartFailed(true);
    }
  }

  return (
    <>
      <SettingGroup>
        <SettingRow
          title="Start at login"
          detail={
            !autostartFailed && (s.autostart.actual === "enabled" || !on)
              ? "Launch Agent Switch automatically when you sign in. It waits in the menu bar."
              : "Couldn't register with the system — try again or check the system's login items."
          }
        >
          {on && s.autostart.actual === "enabled" && <Badge tone="ok">Checked</Badge>}
          <Switch label="Start at login" checked={on} disabled={autostart === null} onChange={(v) => void toggleAutostart(v)} />
        </SettingRow>
        <SettingRow
          title="Open the window on start"
          detail={
            <WithReason
              detail="Off: only the menu bar icon appears."
              reason="Not adjustable yet — Agent Switch always starts in the menu bar; open the window from there."
            />
          }
        >
          <Switch label="Open the window on start" checked={false} disabled onChange={() => {}} />
        </SettingRow>
        {s.platform === "mac" && (
          <SettingRow
            title="Minimize into Dock"
            detail="On: the yellow button minimizes the window into the Dock (macOS standard). Off (default): minimizing or closing removes Agent Switch from the Dock — it stays in the menu bar and reopens from there."
          >
            <Switch label="Minimize into Dock" checked={minimizeToDock} onChange={setMinimizeToDock} />
          </SettingRow>
        )}
        <SettingRow title="Appearance" detail="System follows your OS light/dark setting.">
          <Segmented<Theme>
            label="Appearance"
            size="sm"
            value={theme}
            onChange={setTheme}
            options={[
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
              { value: "system", label: "System" },
            ]}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Usage limits">
        <SettingRow
          title="Auto-refresh limits"
          detail="Refresh usage limits automatically on the interval below. When off, use Refresh on Accounts."
        >
          <Switch label="Auto-refresh limits" checked={autoRefresh} onChange={setAutoRefresh} />
        </SettingRow>
        <SettingRow
          title="Refresh interval"
          detail="How often usage limits refresh. Also the minimum spacing between manual refreshes."
        >
          <div className="w-[120px]">
            <Select
              ariaLabel="Refresh interval"
              value={String(refreshMinutes)}
              onChange={(v) => setRefresh(Number(v))}
              options={REFRESH_INTERVAL_CHOICES.map((m) => ({ value: String(m), label: `${m} min` }))}
            />
          </div>
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Privacy">
        <SettingRow
          title="Hide session summaries"
          detail="Suppress the first-line session summary and the preview in Sessions (the only session content shown in the app)."
        >
          <Switch
            label="Hide session summaries"
            checked={s.hideSummaries}
            onChange={(v) => {
              setHideSummariesFlag(v);
              s.update({ hideSummaries: v });
            }}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Developer">
        <SettingRow
          title="Developer mode"
          detail={
            IS_DEV ? (
              "Adds in-app test helpers: generate 25 test notifications in the bell, force a near-limit suggestion, pet bubble tests and poses. Dev builds only."
            ) : (
              <WithReason
                detail="Adds in-app test helpers: generate 25 test notifications in the bell, force a near-limit suggestion, pet bubble tests and poses. Dev builds only."
                reason="This is a release build."
              />
            )
          }
        >
          <Switch label="Developer mode" checked={devMode} disabled={!IS_DEV} onChange={setDevMode} />
        </SettingRow>
      </SettingGroup>

      <SettingGroup>
        <SettingRow
          title="Quit Agent Switch"
          detail="Running sessions keep running; protection and reminders stop until you open it again."
        >
          <Button size="sm" disabled={!s.act.quit} onClick={() => void run(async () => s.act.quit?.())}>
            <LogOut /> Quit
          </Button>
        </SettingRow>
      </SettingGroup>
    </>
  );
}
