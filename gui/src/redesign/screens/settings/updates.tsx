import { useEffect, useState } from "react";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { Download, RefreshCw } from "lucide-react";
import { cn } from "../../../lib/utils.js";
import { getAutoUpdateCheck, getAutoUpdateKinds, setAutoUpdateCheckFlag, setAutoUpdateKinds } from "../../../settings-store.js";
import { Button } from "../../../ui/Button.js";
import { SettingGroup, SettingRow } from "../../../ui/Setting.js";
import { Switch } from "../../../ui/Switch.js";
import type { UpdateCheck, UpdateKind } from "../../../updates.js";
import { useAS } from "../../../vm/store.js";
import { describeError, usePref } from "./prefs.js";

const UPDATE_KINDS: [UpdateKind, string][] = [
  ["major", "Major"],
  ["minor", "Minor"],
  ["patch", "Bugfix"],
];

type Phase = "idle" | "checking" | "updating" | "done";

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
        setFailure(`Update failed: ${r.output.slice(-300) || "unknown error"}`);
        setPhase("idle");
      }
    } catch (e) {
      setFailure(`Update failed: ${describeError(e)}`);
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
      <SettingGroup>
        <SettingRow
          title="Version"
          detail={
            <>
              Current: <span className="font-ac-mono text-ac-soft">{check?.current ?? "…"}</span>
              {check?.kind === "uptodate" && " · you're on the latest version."}
              {check?.kind === "no-releases" && " · no releases published yet."}
              {check?.kind === "error" && <span className="text-ac-alert-text"> · check failed: {check.message}</span>}
            </>
          }
        >
          <Button size="sm" disabled={phase === "checking" || phase === "updating" || !s.act.checkForUpdate} onClick={() => void runCheck()}>
            <RefreshCw className={cn(phase === "checking" && "animate-spin")} /> {phase === "checking" ? "Checking …" : "Check now"}
          </Button>
        </SettingRow>
        {available && (
          <div className="flex flex-col gap-3 bg-ac-brand-tint px-4 py-3.5">
            <p className="flex items-center gap-2 text-[13px] text-ac-text">
              <span className="size-2 rounded-full bg-ac-brand" aria-hidden />
              {available.tag} available
              {available.publishedAt && (
                <span className="text-xs text-ac-muted">({new Date(available.publishedAt).toLocaleDateString("en-GB")})</span>
              )}
            </p>
            {available.notes && <p className="max-h-24 overflow-y-auto whitespace-pre-wrap text-xs text-ac-muted">{available.notes}</p>}
            <div className="flex flex-wrap items-center gap-2">
              {phase === "done" ? (
                <span className="text-xs text-ac-ok-text">
                  Updated to {available.tag} — restart Agent Switch to apply. Your settings stay as they are.
                </span>
              ) : (
                <>
                  <Button size="sm" variant="primary" disabled={phase === "updating" || !s.act.selfUpdate} onClick={() => void runUpdate()}>
                    <Download /> {phase === "updating" ? "Updating …" : `Update to ${available.tag}`}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void openUrl(available.url).catch(() => {})}>
                    Release notes
                  </Button>
                </>
              )}
            </div>
            {failure && <p className="text-xs text-ac-alert-text">{failure}</p>}
          </div>
        )}
      </SettingGroup>
      <SettingGroup title="Automatic">
        <SettingRow
          title="Automatic updates"
          detail="Check on open and every 24 hours, and install a new version automatically (for the release types selected below). You'll be told to restart once it's applied."
        >
          <Switch label="Automatic updates" checked={auto} onChange={setAuto} />
        </SettingRow>
        {auto && (
          <SettingRow
            title="Install automatically for"
            detail="Uncheck a type to only be notified about it (e.g. leave Major off to review big releases first)."
          >
            {UPDATE_KINDS.map(([kind, label]) => (
              <span key={kind} className="flex items-center gap-2 text-xs text-ac-soft">
                {label}
                <Switch
                  label={`Auto-update ${label}`}
                  checked={kinds.includes(kind)}
                  onChange={(on) => setKinds(on ? [...new Set([...kinds, kind])] : kinds.filter((k) => k !== kind))}
                />
              </span>
            ))}
          </SettingRow>
        )}
      </SettingGroup>
      <p className="px-1 text-[11px] text-ac-faint">agent-config, rtk and the agent CLIs update from Tools.</p>
    </>
  );
}
