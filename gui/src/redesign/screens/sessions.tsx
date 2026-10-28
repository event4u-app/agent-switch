import { useState } from "react";
import { AccountDot } from "../../ui/AccountDot.js";
import { Button } from "../../ui/Button.js";
import { Card, EmptyState } from "../../ui/Card.js";
import { Segmented } from "../../ui/Segmented.js";
import { Select } from "../../ui/Select.js";
import { PageHeader } from "../../ui/Typography.js";
import { TOOL_LABEL } from "../../vm/rules.js";
import { useAS } from "../../vm/store.js";
import type { Tool } from "../../vm/types.js";
import { countSessions, filterSessions, type SessionFilter } from "./logic.js";
import { RowList, SessionColumns, SessionRow } from "./rows.js";

/** Bundle `OP`. */
export function Sessions() {
  const s = useAS();
  const [filter, setFilter] = useState<SessionFilter>("open");
  const [accountId, setAccountId] = useState<string>("all");
  const [tool, setTool] = useState<"all" | Tool>("all");
  const rows = filterSessions(s.sessions, filter, tool, accountId);
  const count = (f: SessionFilter) => countSessions(s.sessions, f);
  const tools = Array.from(new Set(s.sessions.map((x) => x.tool)));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="What runs on which account?" sub="Every session with its account, its protection state and why it got that account." />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Segmented
          label="Show"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "open", label: `Open ${count("open")}` },
            { value: "needs-you", label: `Needs you ${count("needs-you")}` },
            { value: "paused", label: `Paused ${count("paused")}` },
            { value: "done", label: `Done ${count("done")}` },
            { value: "all", label: `All ${count("all")}` },
            ...(count("trash") ? [{ value: "trash" as const, label: `Trash ${count("trash")}` }] : []),
          ]}
        />
        <div className="flex flex-wrap gap-2">
          <div className="w-[150px]">
            <Select
              ariaLabel="Tool"
              value={tool}
              onChange={(v) => setTool(v as "all" | Tool)}
              options={[
                { value: "all", label: "All tools" },
                ...tools.map((t) => ({ value: t, label: `${TOOL_LABEL[t]} ${s.sessions.filter((x) => x.tool === t && !x.trashed).length}` })),
              ]}
            />
          </div>
          <div className="w-[220px]">
            <Select
              ariaLabel="Account"
              value={accountId}
              onChange={setAccountId}
              options={[
                { value: "all", label: "All accounts" },
                ...s.accounts
                  .filter((a) => tool === "all" || a.tool === tool)
                  .map((a) => ({ value: a.id, label: `${TOOL_LABEL[a.tool]} · ${a.name}`, dot: <AccountDot color={a.color} size={8} /> })),
              ]}
            />
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <SessionColumns />
        {rows.length ? (
          <Card className="p-1">
            <RowList>
              {rows.map((x) => (
                <SessionRow key={x.id} session={x} />
              ))}
            </RowList>
          </Card>
        ) : filter === "trash" ? (
          <EmptyState title="The trash is empty." detail="Sessions you move to the trash can be restored here." />
        ) : (
          <EmptyState
            title="No sessions here."
            detail="Start one from the top bar, or keep using claude / codex in your terminal — they show up here on their own."
            action={
              <Button variant="primary" size="sm" onClick={() => s.open({ kind: "start" })}>
                Start session
              </Button>
            }
          />
        )}
      </div>
    </div>
  );
}
