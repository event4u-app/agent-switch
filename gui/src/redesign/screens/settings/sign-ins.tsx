import { useEffect, useState } from "react";
import * as ipc from "../../../ipc.js";
import { Card } from "../../../ui/Card.js";
import { Select } from "../../../ui/Select.js";
import { SettingGroup, SettingRow } from "../../../ui/Setting.js";
import { Switch } from "../../../ui/Switch.js";
import { useRun } from "./prefs.js";
import { WithReason } from "./shared.js";

export const REMIND_UNAVAILABLE = "Not adjustable yet — the CLI sends no expiry reminders today.";

/** Settings › Sign-ins (bundle `cR`, artboard 12). "Keep accounts signed in"
 *  is the CLI's `keep-signed-in`; the reminder has no backend yet and renders
 *  disabled with the reason. */
export function SignInSettings() {
  const run = useRun();
  // null until read: the switch stays disabled rather than showing a guess.
  const [keep, setKeep] = useState<boolean | null>(null);
  useEffect(() => {
    ipc
      .getKeepSignedIn()
      .then(setKeep)
      .catch(() => setKeep(null));
  }, []);

  async function toggleKeep(next: boolean) {
    setKeep(next);
    const ok = await run(async () => (await ipc.setKeepSignedIn(next), true));
    if (!ok) setKeep(!next);
  }

  return (
    <>
      <SettingGroup>
        <SettingRow
          title="Keep accounts signed in"
          detail={
            <>
              Unused Claude accounts are refreshed by Claude Code itself before they lapse. Never with a model request,
              never while a session of that account runs. Needs the background service.
              <span className="mt-1 block text-ac-faint">
                Codex and Antigravity renew their sign-in only when you use them — not covered yet.
              </span>
            </>
          }
        >
          <Switch
            label="Keep accounts signed in"
            checked={keep ?? false}
            disabled={keep === null}
            onChange={(v) => void toggleKeep(v)}
          />
        </SettingRow>
        <SettingRow
          title="Remind me before a sign-in expires"
          detail={
            <WithReason
              detail="Once, and once more when it has expired. Successful refreshes stay silent."
              reason={REMIND_UNAVAILABLE}
            />
          }
        >
          <div className="w-[160px]">
            <Select
              ariaLabel="Remind me before a sign-in expires"
              value="5"
              disabled
              onChange={() => {}}
              options={[
                { value: "3", label: "3 days before" },
                { value: "5", label: "5 days before", hint: "Like Claude Code" },
                { value: "7", label: "7 days before" },
              ]}
            />
          </div>
        </SettingRow>
      </SettingGroup>
      <Card className="flex flex-col gap-2 p-4">
        <p className="text-[13px] text-ac-text">What Agent Switch can't prevent</p>
        <p className="text-xs text-ac-muted">
          A password change, signing out on another device, an admin's session limit or a revoked access end a sign-in
          for good. Then you get one notice and a single button that opens the provider's sign-in for exactly that
          account. Agent Switch never stores passwords or tokens.
        </p>
      </Card>
    </>
  );
}
