import { useCallback, useEffect, useState } from "react";
import { Check, RefreshCw } from "lucide-react";
import { t, tp } from "../../../i18n/index.js";
import * as ipc from "../../../ipc.js";
import { Badge } from "../../../ui/Badge.js";
import { Button } from "../../../ui/Button.js";
import { Card } from "../../../ui/Card.js";
import { SettingRow } from "../../../ui/Setting.js";
import { Switch } from "../../../ui/Switch.js";
import { useRun } from "./prefs.js";

/** Settings › Updates: every account follows its source (`agent-switch sync`). */
export function FollowCard({ load = ipc.followStatus }: { load?: () => Promise<ipc.FollowStatus> }) {
  const run = useRun();
  const [status, setStatus] = useState<ipc.FollowStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const reload = useCallback(async () => {
    try {
      setStatus(await load());
    } catch {
      setStatus(null);
    }
  }, [load]);
  useEffect(() => void reload(), [reload]);
  if (!status) return null;

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    await run(async () => (await fn(), true));
    await reload();
    setBusy(false);
  };
  const waiting = status.targets.filter((x) => x.state === "pending-approval");
  const off = status.targets.filter((x) => x.state === "failed" || x.state === "differs" || x.state === "pending-app-running" || x.state === "unsynced");

  return (
    <Card className="flex flex-col gap-2 px-4 py-3.5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] text-ac-text">{t("settings.claude.follow.title")}</p>
          <p className="mt-0.5 text-[11px] text-ac-muted">{t("settings.claude.follow.detail")}</p>
        </div>
        <Badge tone={off.length || waiting.length ? "warn" : "ok"} dot>
          {off.length || waiting.length ? tp("settings.claude.follow.notInStep", off.length + waiting.length) : t("settings.claude.follow.inStep")}
        </Badge>
        <Button size="sm" disabled={busy} onClick={() => void act(ipc.followSyncNow)}>
          <RefreshCw /> {t("settings.claude.follow.syncNow")}
        </Button>
      </div>
      <SettingRow title={t("settings.claude.follow.confirm")} detail={t("settings.claude.follow.confirmDetail")}>
        <Switch label={t("settings.claude.follow.confirm")} checked={status.confirmNew} disabled={busy} onChange={(v) => void act(() => ipc.setFollowConfirm(v))} />
      </SettingRow>
      {waiting.length > 0 && (
        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
          <p className="min-w-0 flex-1 text-[11px] text-ac-muted">{waiting.map((x) => `${x.key}: ${x.detail}`).join(" · ")}</p>
          <Button size="sm" disabled={busy} onClick={() => void act(ipc.followApprove)}>
            <Check /> {t("settings.claude.follow.approve")}
          </Button>
        </div>
      )}
      {off.map((x) => (
        <p key={x.key} className="text-[11px] text-ac-muted">
          <span className="font-ac-mono">{x.key}</span> — {x.detail || t("settings.claude.follow.unsynced")}
        </p>
      ))}
    </Card>
  );
}
