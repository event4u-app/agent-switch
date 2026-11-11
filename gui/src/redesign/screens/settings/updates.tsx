import { useEffect, useState } from "react";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { Download, RefreshCw, RotateCw } from "lucide-react";
import { getLang, locale, t, type TKey } from "../../../i18n/index.js";
import { tx } from "../../../i18n/react.js";
import { cn } from "../../../lib/utils.js";
import { getAutoUpdateCheck, getAutoUpdateKinds, setAutoUpdateCheckFlag, setAutoUpdateKinds } from "../../../settings-store.js";
import { Button } from "../../../ui/Button.js";
import { SettingGroup, SettingRow } from "../../../ui/Setting.js";
import { Switch } from "../../../ui/Switch.js";
import type { UpdateCheck, UpdateKind } from "../../../updates.js";
import { useAS } from "../../../vm/store.js";
import { FollowCard } from "./follow.js";
import { describeError, usePref } from "./prefs.js";

const UPDATE_KINDS: [UpdateKind, TKey][] = [
  ["major", "settings.updates.major"],
  ["minor", "settings.updates.minor"],
  ["patch", "settings.updates.patch"],
];

type Phase = "idle" | "checking" | "updating" | "done";

/** Quits and starts Agent Switch again on the version just installed. */
export function RestartButton({ restart }: { restart: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  return (
    <>
      <Button
        size="sm"
        variant="primary"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setFailure(null);
          restart().catch((e) => {
            setFailure(t("settings.updates.restartFailed", { error: describeError(e) }));
            setBusy(false);
          });
        }}
      >
        <RotateCw /> {busy ? t("settings.updates.restarting") : t("settings.updates.restartNow")}
      </Button>
      {failure && <span className="text-xs text-ac-alert-text">{failure}</span>}
    </>
  );
}

/** Settings › Updates (bundle `mR`, artboard 25). */
export function UpdatesSettings() {
  const s = useAS();
  const [check, setCheck] = useState<UpdateCheck | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [failure, setFailure] = useState<string | null>(null);
  const [auto, setAuto] = usePref(getAutoUpdateCheck, setAutoUpdateCheckFlag);
  const [kinds, setKinds] = usePref<UpdateKind[]>(getAutoUpdateKinds, setAutoUpdateKinds);

  async function runCheck() {
    if (!s.act.checkForUpdate) return;
    setPhase("checking");
    try {
      setCheck(await s.act.checkForUpdate());
    } catch (e) {
      setCheck({ kind: "error", current: check?.current ?? "…", message: describeError(e) } as UpdateCheck);
    } finally {
      setPhase("idle");
    }
  }

  async function runUpdate() {
    if (!s.act.selfUpdate) return;
    setPhase("updating");
    setFailure(null);
    try {
      const r = await s.act.selfUpdate();
      if (r.ok) setPhase("done");
      else {
        setFailure(t("settings.updates.updateFailed", { error: r.output.slice(-300) || t("settings.updates.unknownError") }));
        setPhase("idle");
      }
    } catch (e) {
      setFailure(t("settings.updates.updateFailed", { error: describeError(e) }));
      setPhase("idle");
    }
  }

  useEffect(() => {
    void runCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const available = check?.kind === "available" ? check.release : null;

  return (
    <>
      <FollowCard />
      <SettingGroup>
        <SettingRow
          title={t("settings.updates.version")}
          detail={
            <>
              {tx("settings.updates.current", { version: <span className="font-ac-mono text-ac-soft">{check?.current ?? "…"}</span> })}
              {check?.kind === "uptodate" && t("settings.updates.upToDate")}
              {check?.kind === "no-releases" && t("settings.updates.noReleases")}
              {check?.kind === "error" && (
                <span className="text-ac-alert-text">{t("settings.updates.checkFailed", { error: check.message })}</span>
              )}
            </>
          }
        >
          <Button size="sm" disabled={phase === "checking" || phase === "updating" || !s.act.checkForUpdate} onClick={() => void runCheck()}>
            <RefreshCw className={cn(phase === "checking" && "animate-spin")} /> {phase === "checking" ? t("settings.updates.checking") : t("settings.updates.checkNow")}
          </Button>
        </SettingRow>
        {available && (
          <div className="flex flex-col gap-3 bg-ac-brand-tint px-4 py-3.5">
            <p className="flex items-center gap-2 text-[13px] text-ac-text">
              <span className="size-2 rounded-full bg-ac-brand" aria-hidden />
              {t("settings.updates.available", { tag: available.tag })}
              {available.publishedAt && (
                <span className="text-xs text-ac-muted">
                  ({new Date(available.publishedAt).toLocaleDateString(getLang() === "en" ? "en-GB" : locale())})
                </span>
              )}
            </p>
            {available.notes && <p className="max-h-24 overflow-y-auto whitespace-pre-wrap text-xs text-ac-muted">{available.notes}</p>}
            <div className="flex flex-wrap items-center gap-2">
              {phase === "done" ? (
                <>
                  <span className="text-xs text-ac-ok-text">{t("settings.updates.updated", { tag: available.tag })}</span>
                  {s.act.restart && <RestartButton restart={s.act.restart} />}
                </>
              ) : (
                <>
                  <Button size="sm" variant="primary" disabled={phase === "updating" || !s.act.selfUpdate} onClick={() => void runUpdate()}>
                    <Download /> {phase === "updating" ? t("settings.updates.updating") : t("settings.updates.updateTo", { tag: available.tag })}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void openUrl(available.url).catch(() => {})}>
                    {t("settings.updates.releaseNotes")}
                  </Button>
                </>
              )}
            </div>
            {failure && <p className="text-xs text-ac-alert-text">{failure}</p>}
          </div>
        )}
      </SettingGroup>
      <SettingGroup title={t("settings.updates.automatic")}>
        <SettingRow
          title={t("settings.updates.automaticUpdates")}
          detail={t("settings.updates.automaticUpdatesDetail")}
        >
          <Switch label={t("settings.updates.automaticUpdates")} checked={auto} onChange={setAuto} />
        </SettingRow>
        {auto && (
          <SettingRow
            title={t("settings.updates.installFor")}
            detail={t("settings.updates.installForDetail")}
          >
            {UPDATE_KINDS.map(([kind, labelKey]) => (
              <span key={kind} className="flex items-center gap-2 text-xs text-ac-soft">
                {t(labelKey)}
                <Switch
                  label={t("settings.updates.autoUpdateKind", { kind: t(labelKey) })}
                  checked={kinds.includes(kind)}
                  onChange={(on) => setKinds(on ? [...new Set([...kinds, kind])] : kinds.filter((k) => k !== kind))}
                />
              </span>
            ))}
          </SettingRow>
        )}
      </SettingGroup>
      <p className="px-1 text-[11px] text-ac-faint">{t("settings.updates.toolsNote")}</p>
    </>
  );
}
