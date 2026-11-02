import { useEffect, useRef, useState } from "react";
import { LogOut, MessageCircle, Star } from "lucide-react";
import { setLanguagePref, t, type LanguagePref } from "../../../i18n/index.js";
import * as ipc from "../../../ipc.js";
import {
  getAutoRefreshLimits,
  getDevMode,
  getLanguagePref,
  getMinimizeToDock,
  getRefreshMinutes,
  REFRESH_INTERVAL_CHOICES,
  setAutoRefreshLimitsFlag,
  setDevModeFlag,
  setHideSummariesFlag,
  setMinimizeToDockFlag,
  setNextUsageRefreshAt,
  setRefreshMinutes,
  setTrayShowDisabledFlag,
} from "../../../settings-store.js";
import { REDDIT_POST_URL, REPO_URL, setStarAskStopped } from "../../../star-ask.js";
import { applyTheme, getTheme, type Theme } from "../../../theme.js";
import { Badge } from "../../../ui/Badge.js";
import { Button } from "../../../ui/Button.js";
import { Segmented } from "../../../ui/Segmented.js";
import { Select } from "../../../ui/Select.js";
import { SettingGroup, SettingRow } from "../../../ui/Setting.js";
import { Switch } from "../../../ui/Switch.js";
import { useAS } from "../../../vm/store.js";
import { ShareButtons } from "../star-ask-banner.js";
import { openExternal } from "../tools.js";
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
  // Follow the system state as reloads bring it (switched off in System
  // Settings, or on again) — except while our own toggle is in flight.
  const toggling = useRef(false);
  const actual = s.autostart.actual;
  useEffect(() => {
    if (toggling.current || actual == null) return;
    setAutostartState(actual === "enabled");
  }, [actual]);
  const [minimizeToDock, setMinimizeToDock] = usePref(getMinimizeToDock, writeMinimizeToDock);
  const [theme, setTheme] = usePref<Theme>(getTheme, applyTheme);
  const [autoRefresh, setAutoRefresh] = usePref(getAutoRefreshLimits, writeAutoRefresh);
  const [refreshMinutes, setRefresh] = usePref(getRefreshMinutes, setRefreshMinutes);
  const [devMode, setDevMode] = usePref(() => IS_DEV && getDevMode(), setDevModeFlag);
  const [language, setLanguage] = usePref<LanguagePref>(getLanguagePref, setLanguagePref);
  const on = autostart ?? false;

  async function toggleAutostart(next: boolean) {
    setAutostartState(next);
    setAutostartFailed(false);
    toggling.current = true;
    const ok = await run(async () => {
      if (!s.act.setAutostart) throw new Error(t("settings.general.startAtLoginUnavailable"));
      await s.act.setAutostart(next);
      return true;
    }).finally(() => {
      toggling.current = false;
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
          title={t("settings.general.startAtLogin")}
          detail={
            !autostartFailed && (s.autostart.actual === "enabled" || !on)
              ? t("settings.general.startAtLoginDetail")
              : t("settings.general.startAtLoginFailed")
          }
        >
          {on && s.autostart.actual === "enabled" && <Badge tone="ok">{t("settings.general.checked")}</Badge>}
          <Switch label={t("settings.general.startAtLogin")} checked={on} disabled={autostart === null} onChange={(v) => void toggleAutostart(v)} />
        </SettingRow>
        <SettingRow
          title={t("settings.general.openOnStart")}
          detail={
            <WithReason
              detail={t("settings.general.openOnStartDetail")}
              reason={t("settings.general.openOnStartReason")}
            />
          }
        >
          <Switch label={t("settings.general.openOnStart")} checked={false} disabled onChange={() => {}} />
        </SettingRow>
        <SettingRow
          title={t("settings.general.trayShowDisabled")}
          detail={t("settings.general.trayShowDisabledDetail")}
        >
          <Switch
            label={t("settings.general.trayShowDisabled")}
            checked={s.trayShowDisabled}
            onChange={(v) => {
              setTrayShowDisabledFlag(v);
              s.update({ trayShowDisabled: v });
            }}
          />
        </SettingRow>
        {s.platform === "mac" && (
          <SettingRow
            title={t("settings.general.minimizeToDock")}
            detail={t("settings.general.minimizeToDockDetail")}
          >
            <Switch label={t("settings.general.minimizeToDock")} checked={minimizeToDock} onChange={setMinimizeToDock} />
          </SettingRow>
        )}
        <SettingRow title={t("settings.general.appearance")} detail={t("settings.general.appearanceDetail")}>
          <Segmented<Theme>
            label={t("settings.general.appearance")}
            size="sm"
            value={theme}
            onChange={setTheme}
            options={[
              { value: "light", label: t("settings.general.themeLight") },
              { value: "dark", label: t("settings.general.themeDark") },
              { value: "system", label: t("settings.general.themeSystem") },
            ]}
          />
        </SettingRow>
        <SettingRow title={t("settings.general.language")} detail={t("settings.general.languageDetail")}>
          <Segmented<LanguagePref>
            label={t("settings.general.language")}
            size="sm"
            value={language}
            onChange={setLanguage}
            options={[
              { value: "system", label: t("settings.general.languageSystem") },
              { value: "en", label: t("settings.general.languageEnglish") },
              { value: "de", label: t("settings.general.languageGerman") },
            ]}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title={t("settings.general.usageLimits")}>
        <SettingRow
          title={t("settings.general.autoRefresh")}
          detail={t("settings.general.autoRefreshDetail")}
        >
          <Switch label={t("settings.general.autoRefresh")} checked={autoRefresh} onChange={setAutoRefresh} />
        </SettingRow>
        <SettingRow
          title={t("settings.general.refreshInterval")}
          detail={t("settings.general.refreshIntervalDetail")}
        >
          <div className="w-[120px]">
            <Select
              ariaLabel={t("settings.general.refreshInterval")}
              value={String(refreshMinutes)}
              onChange={(v) => setRefresh(Number(v))}
              options={REFRESH_INTERVAL_CHOICES.map((m) => ({ value: String(m), label: t("settings.general.minutes", { n: m }) }))}
            />
          </div>
        </SettingRow>
      </SettingGroup>

      <SettingGroup title={t("settings.general.privacy")}>
        <SettingRow
          title={t("settings.general.hideSummaries")}
          detail={t("settings.general.hideSummariesDetail")}
        >
          <Switch
            label={t("settings.general.hideSummaries")}
            checked={s.hideSummaries}
            onChange={(v) => {
              setHideSummariesFlag(v);
              s.update({ hideSummaries: v });
            }}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title={t("settings.general.developer")}>
        <SettingRow
          title={t("settings.general.devMode")}
          detail={
            IS_DEV ? (
              t("settings.general.devModeDetail")
            ) : (
              <WithReason detail={t("settings.general.devModeDetail")} reason={t("settings.general.devModeReason")} />
            )
          }
        >
          <Switch label={t("settings.general.devMode")} checked={devMode} disabled={!IS_DEV} onChange={setDevMode} />
        </SettingRow>
      </SettingGroup>

      <SettingGroup
        tone="violet"
        title={t("settings.general.support")}
        detail={t("settings.general.supportDetail")}
      >
        <SettingRow title={t("settings.general.starOnGitHub")} detail={t("settings.general.starDetail")}>
          <Button
            size="sm"
            variant="primary"
            className="bg-ac-violet"
            title={REPO_URL}
            onClick={() => {
              openExternal(REPO_URL);
              setStarAskStopped("starred");
            }}
          >
            <Star /> {t("settings.general.star")}
          </Button>
        </SettingRow>
        <SettingRow title={t("settings.general.voteOnReddit")} detail={t("settings.general.voteDetail")}>
          <Button size="sm" variant="primary" className="bg-ac-violet" title={REDDIT_POST_URL} onClick={() => openExternal(REDDIT_POST_URL)}>
            <MessageCircle /> {t("settings.general.openRedditPost")}
          </Button>
        </SettingRow>
        <SettingRow title={t("settings.general.share")} detail={t("settings.general.shareDetail")} stacked>
          <ShareButtons variant="violet" />
        </SettingRow>
      </SettingGroup>

      <SettingGroup>
        <SettingRow
          title={t("settings.general.quitTitle")}
          detail={t("settings.general.quitDetail")}
        >
          <Button size="sm" disabled={!s.act.quit} onClick={() => s.open({ kind: "quit" })}>
            <LogOut /> {t("settings.general.quit")}
          </Button>
        </SettingRow>
      </SettingGroup>
    </>
  );
}
