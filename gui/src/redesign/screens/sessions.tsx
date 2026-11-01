import { useState } from "react";
import { t } from "../../i18n/index.js";
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
      <PageHeader title={t("sessions.list.title")} sub={t("sessions.list.sub")} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Segmented
          label={t("sessions.list.show")}
          value={filter}
          onChange={setFilter}
          options={[
            { value: "open", label: t("sessions.list.open", { count: count("open") }) },
            { value: "needs-you", label: t("sessions.list.needsYou", { count: count("needs-you") }) },
            { value: "paused", label: t("sessions.list.paused", { count: count("paused") }) },
            { value: "done", label: t("sessions.list.done", { count: count("done") }) },
            { value: "all", label: t("sessions.list.all", { count: count("all") }) },
            ...(count("trash") ? [{ value: "trash" as const, label: t("sessions.list.trash", { count: count("trash") }) }] : []),
          ]}
        />
        <div className="flex flex-wrap gap-2">
          <div className="w-[150px]">
            <Select
              ariaLabel={t("sessions.list.tool")}
              value={tool}
              onChange={(v) => setTool(v as "all" | Tool)}
              options={[
                { value: "all", label: t("sessions.list.allTools") },
                ...tools.map((tl) => ({ value: tl, label: `${TOOL_LABEL[tl]} ${s.sessions.filter((x) => x.tool === tl && !x.trashed).length}` })),
              ]}
            />
          </div>
          <div className="w-[220px]">
            <Select
              ariaLabel={t("sessions.list.account")}
              value={accountId}
              onChange={setAccountId}
              options={[
                { value: "all", label: t("sessions.list.allAccounts") },
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
          <EmptyState title={t("sessions.list.trashEmpty")} detail={t("sessions.list.trashEmptyDetail")} />
        ) : (
          <EmptyState
            title={t("sessions.list.empty")}
            detail={t("sessions.list.emptyDetail")}
            action={
              <Button variant="primary" size="sm" onClick={() => s.open({ kind: "start" })}>
                {t("sessions.list.start")}
              </Button>
            }
          />
        )}
      </div>
    </div>
  );
}
