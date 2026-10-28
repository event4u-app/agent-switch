import { Card } from "../../../ui/Card.js";
import { Select } from "../../../ui/Select.js";
import { SettingGroup, SettingRow } from "../../../ui/Setting.js";
import { Switch } from "../../../ui/Switch.js";
import { WithReason } from "./shared.js";

export const KEEP_SIGNED_IN_UNAVAILABLE =
  "Not adjustable yet — the CLI has no keep-signed-in maintenance to turn on or off.";
export const REMIND_UNAVAILABLE = "Not adjustable yet — the CLI sends no expiry reminders today.";

/** Settings › Sign-ins (bundle `cR`, artboard 12). Neither control has a
 *  backend yet: both render disabled with the reason. */
export function SignInSettings() {
  return (
    <>
      <SettingGroup>
        <SettingRow
          title="Keep accounts signed in"
          detail={
            <WithReason
              detail="Unused accounts are refreshed by the provider's own tool before they lapse. Never with a model request, never while a session of that account runs."
              reason={KEEP_SIGNED_IN_UNAVAILABLE}
            />
          }
        >
          <Switch label="Keep accounts signed in" checked={false} disabled onChange={() => {}} />
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
