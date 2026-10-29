import { useState } from "react";
import { Trash2, TriangleAlert } from "lucide-react";
import { Button } from "../../../ui/Button.js";
import { Segmented } from "../../../ui/Segmented.js";
import { SettingGroup, SettingRow } from "../../../ui/Setting.js";
import { TextInput } from "../../../ui/TextInput.js";
import { useAS } from "../../../vm/store.js";
import type { GuardPolicy } from "../../../vm/types.js";
import { uninstallArmed, useFoundation, useRun } from "./prefs.js";
import { WithReason } from "./shared.js";

export const DIAGNOSTICS_UNAVAILABLE = "Not available yet — the CLI has no diagnostics export. Health shows every check.";

/** Settings › Advanced (bundle `xR`, artboard 26). */
export function AdvancedSettings() {
  const s = useAS();
  const fa = useFoundation();
  const run = useRun();
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const armed = uninstallArmed(confirm);

  async function uninstall() {
    if (!s.act.uninstall) return;
    setBusy(true);
    const ok = await run(async () => (await s.act.uninstall!(), true));
    if (ok) await run(async () => s.act.quit?.());
    setBusy(false);
  }

  return (
    <>
      <SettingGroup>
        <SettingRow
          title="Same account in two places"
          detail={
            s.guard.policy
              ? "Warn is safe for most setups; Block only for sign-ins that break when shared."
              : <WithReason detail="Warn is safe for most setups; Block only for sign-ins that break when shared." reason="The current policy wasn't read — pick one to set it." />
          }
        >
          <Segmented<GuardPolicy>
            label="Same account in two places"
            size="sm"
            value={(s.guard.policy ?? "") as GuardPolicy}
            onChange={(p) => void run(() => fa.setGuard(p))}
            options={[
              { value: "warn", label: "Warn" },
              { value: "block", label: "Block" },
              { value: "off", label: "Off" },
            ]}
          />
        </SettingRow>
        <SettingRow
          title="Diagnostics"
          detail={
            <WithReason
              detail="A report without tokens, cookies or project paths, to attach to an issue."
              reason={DIAGNOSTICS_UNAVAILABLE}
            />
          }
        >
          <Button size="sm" disabled title={DIAGNOSTICS_UNAVAILABLE}>
            Export
          </Button>
        </SettingRow>
      </SettingGroup>
      <SettingGroup title="Danger zone">
        <SettingRow
          tone="danger"
          stacked
          title={
            <span className="flex items-center gap-1.5">
              <TriangleAlert className="size-4" /> Uninstall Agent Switch
            </span>
          }
          detail={
            <>
              Removes <strong className="text-ac-soft">all</strong> Agent Switch profiles, credentials, directory
              mappings, and the background daemon under <span className="font-ac-mono">~/.agent-switch</span>. This cannot
              be undone.
            </>
          }
        >
          <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-xs text-ac-muted">
            <span>
              Type <span className="font-ac-mono text-ac-text">uninstall</span> to confirm
            </span>
            <TextInput mono placeholder="uninstall" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </label>
          <Button
            size="sm"
            variant="danger"
            disabled={!armed || busy || !s.act.uninstall}
            onClick={() => void uninstall()}
            className="self-end"
          >
            <Trash2 /> Uninstall Agent Switch
          </Button>
        </SettingRow>
      </SettingGroup>
    </>
  );
}
