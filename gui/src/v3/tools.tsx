/**
 * Tools (spec §10.4): the 2.11 Tools screen on the v3 page body, and its
 * updates as Needs-you items. An update installs the new version for sessions
 * started afterwards; it never restarts or touches a running session.
 */

import type { ReactNode } from "react";
import type { ToolEntry } from "../vm/types.js";
import type { NeedItem } from "./needs.js";
import { PageBody } from "./pages.js";

export function ToolsPage({ children }: { children: ReactNode }) {
  return (
    <PageBody title="Tools" sub="The CLIs Agent Switch runs, their versions and updates. Updating never touches a running session.">
      {children}
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
