/**
 * Tools (spec §10.4, tools.png): one row per tool, and its updates as
 * Needs-you items. An update installs the new version for sessions
 * started afterwards; it never restarts or touches a running session.
 */

import type { ReactNode } from "react";
import { Download, LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "../ui/Button.js";
import type { ToolStatus } from "../vm/rules.js";
import type { ToolEntry } from "../vm/types.js";
import { Act, Chip } from "./kit.js";
import type { NeedItem } from "./needs.js";
import { PageBody } from "./pages.js";

export interface ToolRowView {
  id: string;
  name: string;
  /** Path, or how it is installed, plus one fact ("· signed in"). */
  where: string | null;
  version: string | null;
  status: ToolStatus;
  latest: string | null;
}

const STATUS_CHIP: Partial<Record<ToolStatus, string>> = { ok: "up to date", unknown: "latest unknown", attention: "needs a look" };

export function ToolsPage({ rows, checking, on, below }: { rows: ToolRowView[]; checking: boolean; on: { check: () => void; update: (id: string) => void; install: (id: string) => void }; below?: ReactNode }) {
  return (
    <PageBody
      title="Tools"
      sub="What Agent Switch runs, which version, and what's new. Updates never touch running sessions."
      actions={
        <Button size="sm" onClick={on.check} disabled={checking}>
          {checking ? <LoaderCircle className="animate-spin" /> : <RefreshCw />} {checking ? "Checking…" : "Check now"}
        </Button>
      }
    >
      <ul aria-label="Tools" className="overflow-hidden rounded-[10px] border border-ac-line bg-ac-panel">
        {rows.map((t) => (
          <li key={t.id} className="grid grid-cols-[minmax(0,1fr)_130px_140px] items-center gap-3 border-b border-ac-line px-4 py-3 last:border-b-0">
            <span className="min-w-0">
              <span className="block truncate text-[13px] text-ac-text">{t.name}</span>
              {t.where && (
                <span className="mt-0.5 block truncate font-ac-mono text-[11px] text-ac-muted" title={t.where}>
                  {t.where}
                </span>
              )}
            </span>
            <span className="font-ac-mono text-xs text-ac-soft">{t.version ?? "—"}</span>
            <span className="flex justify-end">
              {t.status === "update" && t.latest ? (
                <Act kind="accent" onClick={() => on.update(t.id)}>
                  <Download /> Update to {t.latest}
                </Act>
              ) : t.status === "missing" ? (
                <Act kind="accent" onClick={() => on.install(t.id)}>
                  <Download /> Install
                </Act>
              ) : (
                <Chip tone={t.status === "attention" ? "warn" : undefined} kind={t.status === "attention" ? "status" : "meta"}>
                  {STATUS_CHIP[t.status] ?? t.status}
                </Chip>
              )}
            </span>
          </li>
        ))}
      </ul>
      {below && <div className="mt-6">{below}</div>}
    </PageBody>
  );
}

/** One "update" item per installed tool behind its latest version; dismissing with Later holds until the next version. Pure. */
export function updateNeeds(tools: readonly ToolEntry[], since: string): NeedItem[] {
  return tools
    .filter((t) => t.present && t.version && t.latest && t.latest !== t.version)
    .map((t) => ({
      id: `update:${t.id}`,
      kind: "update",
      subject: `tool:${t.id}`,
      who: t.name,
      what: `${t.version} → ${t.latest}`,
      detail: "Running sessions keep the version they started with.",
      verb: "Update",
      since,
      version: t.latest!,
    }));
}
