import { useState } from "react";
import * as ipc from "../../../ipc.js";
import { Button } from "../../../ui/Button.js";
import { Segmented } from "../../../ui/Segmented.js";
import { Select } from "../../../ui/Select.js";
import { SettingGroup, SettingRow } from "../../../ui/Setting.js";
import { splitAccountId } from "../../../vm/actions.js";
import { useAS } from "../../../vm/store.js";
import { suggestedPoolTags, useRun } from "./prefs.js";
import { WithReason } from "./shared.js";

export const UNBOUND_UNAVAILABLE =
  "Not adjustable yet — without a project binding a plain start uses the default account.";
export const PER_ACCOUNT_UNAVAILABLE = "Not adjustable yet — the CLI sets no limit on sessions per account.";

/** Settings › Distribution (bundle `dR`). */
export function DistributionSettings() {
  const s = useAS();
  const run = useRun();
  const [creating, setCreating] = useState<string | null>(null);
  const suggested = suggestedPoolTags(s.accounts, s.pools);

  async function createFromTag(tag: string) {
    setCreating(tag);
    await run(async () => {
      const pool = await ipc.createPool(tag);
      for (const a of s.accounts.filter((x) => x.label === tag)) {
        const [provider, name] = splitAccountId(a.id);
        await ipc.addPoolMember(pool.id, provider, name);
      }
      s.toast({ text: `Created pool “${tag}”.`, tone: "ok" });
    });
    setCreating(null);
    await s.reload();
  }

  return (
    <>
      <SettingGroup>
        <SettingRow
          title="Starts without a project binding"
          detail={<WithReason detail="Project bindings always win. This decides the rest." reason={UNBOUND_UNAVAILABLE} />}
        >
          <Segmented
            label="Starts without a project binding"
            size="sm"
            value="default"
            onChange={() => {}}
            options={[
              { value: "pool", label: "Most left in pool", disabled: true, why: UNBOUND_UNAVAILABLE },
              { value: "default", label: "Default account" },
              { value: "ask", label: "Ask me", disabled: true, why: UNBOUND_UNAVAILABLE },
            ]}
          />
        </SettingRow>
        <SettingRow
          title="Sessions per account"
          detail={
            <WithReason
              detail="Several sessions may share one account; they share its capacity."
              reason={PER_ACCOUNT_UNAVAILABLE}
            />
          }
        >
          <div className="w-[140px]">
            <Select
              ariaLabel="Sessions per account"
              value="any"
              disabled
              onChange={() => {}}
              options={[
                { value: "any", label: "No limit" },
                { value: "1", label: "1" },
                { value: "2", label: "Up to 2" },
                { value: "3", label: "Up to 3" },
                { value: "5", label: "Up to 5" },
              ]}
            />
          </div>
        </SettingRow>
        <SettingRow
          title="Accounts and pools"
          detail="Tags describe an account (Work, Personal, Other). Pools say which accounts a project may use; one account can be in several pools. Pools never add up provider limits."
        >
          <Button
            size="sm"
            onClick={() => {
              s.go("accounts");
              s.setAccountsTab("projects");
            }}
          >
            Projects & pools
          </Button>
        </SettingRow>
      </SettingGroup>
      {suggested.length > 0 && (
        <SettingGroup title="Suggested">
          {suggested.map((tag) => (
            <SettingRow
              key={tag}
              title={`Create pool “${tag}” from your ${tag} accounts`}
              detail="Only a suggestion — nothing changes until you create it."
            >
              <Button size="sm" disabled={creating !== null} onClick={() => void createFromTag(tag)}>
                {creating === tag ? "Creating …" : "Create pool"}
              </Button>
            </SettingRow>
          ))}
        </SettingGroup>
      )}
    </>
  );
}
