import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { cn } from "../../lib/utils.js";
import type { DirResolution } from "../../ipc.js";
import { AccountDot } from "../../ui/AccountDot.js";
import { Badge } from "../../ui/Badge.js";
import { Button } from "../../ui/Button.js";
import { Card } from "../../ui/Card.js";
import { shortPath } from "../../ui/format.js";
import { Segmented } from "../../ui/Segmented.js";
import { Select } from "../../ui/Select.js";
import { Switch } from "../../ui/Switch.js";
import { SectionHeader } from "../../ui/Typography.js";
import { accountIdFromMember } from "../../vm/build.js";
import { TOOL_LABEL } from "../../vm/rules.js";
import { useAS } from "../../vm/store.js";
import type { Tool } from "../../vm/types.js";
import { RowList } from "./rows.js";
import { recentFolders } from "./logic.js";

type Explain = { state: "idle" } | { state: "loading" } | { state: "done"; res: DirResolution } | { state: "error"; message: string };

/** The "Try a folder" answer from the CLI (`dir --json`). */
function useExplain(dir: string, tool: Tool): Explain {
  const s = useAS();
  const [out, setOut] = useState<Explain>({ state: "idle" });
  const explain = s.act.explainFolder;
  useEffect(() => {
    if (!dir || !explain) {
      setOut({ state: "idle" });
      return;
    }
    let cancelled = false;
    setOut({ state: "loading" });
    explain(dir, tool).then(
      (res) => !cancelled && setOut({ state: "done", res }),
      (e: unknown) => !cancelled && setOut({ state: "error", message: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      cancelled = true;
    };
  }, [dir, tool, explain]);
  return out;
}

/** Accounts › Projects & pools. Bundle `VP`. */
export function ProjectsPools() {
  const s = useAS();
  const folders = recentFolders(s.sessions);
  const [dir, setDir] = useState(folders[0] ?? "");
  const [tool, setTool] = useState<Tool>("claude");
  const ex = useExplain(dir, tool);
  const account = ex.state === "done" ? s.accountById(accountIdFromMember(ex.res.profile) ?? "") : undefined;
  const why = ex.state === "done" ? ex.res.why : ex.state === "error" ? [ex.message] : [];

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <Select label="Try a folder" mono value={dir} onChange={setDir} options={folders.map((f) => ({ value: f, label: shortPath(f) }))} />
          </div>
          <Segmented
            label="Tool"
            value={tool}
            onChange={setTool}
            options={[
              { value: "claude", label: "Claude" },
              { value: "codex", label: "Codex" },
              { value: "gemini", label: "Gemini", disabled: true, why: "Gemini has no backend yet." },
            ]}
          />
        </div>
        <div className="flex items-start gap-3 rounded-lg border border-ac-line bg-ac-bg p-3">
          {account ? <AccountDot color={account.color} size={10} /> : <span className="size-2.5 rounded-full border border-ac-line2" />}
          <div className="min-w-0 flex-1">
            <p className="text-[13px] text-ac-text">
              {account ? (
                <>
                  Starts on{" "}
                  <b className="font-medium">
                    {TOOL_LABEL[account.tool]} · {account.name}
                  </b>
                </>
              ) : !dir ? (
                "No folder to try yet — folders show up here once a session ran in them."
              ) : ex.state === "loading" || ex.state === "idle" ? (
                "Checking …"
              ) : ex.state === "done" && ex.res.profile == null ? (
                `Starts on your original ${TOOL_LABEL[tool]} login`
              ) : (
                "No account can take this start"
              )}
            </p>
            <ul className="mt-1 flex flex-col gap-0.5">
              {why.map((w) => (
                <li key={w} className="text-[11px] text-ac-muted">
                  · {w}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Card>

      <section className="flex flex-col gap-1">
        <SectionHeader
          title="Project bindings"
          count={s.rules.length}
          actions={
            <Button size="sm" variant="ghost" disabled title="Not in this window yet — bind a folder with `agent-switch map <account> <folder>`.">
              <Plus /> Add binding
            </Button>
          }
        />
        <p className="px-1 pb-2 text-xs text-ac-muted">
          First match wins. A binding to a pool lets the pool pick the account with the most left — work and personal never mix.
        </p>
        <Card className="p-1">
          <RowList>
            {s.rules.map((r) => {
              const a = r.target.kind === "account" ? s.accountById(r.target.accountId) : undefined;
              return (
                <div
                  key={r.id}
                  className={cn(
                    "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-3 py-2.5 md:grid-cols-[72px_minmax(0,1fr)_minmax(150px,210px)_64px_auto]",
                    !r.enabled && "opacity-60",
                  )}
                >
                  <span className="hidden md:block">
                    <Badge>{r.match.kind}</Badge>
                  </span>
                  <span className="min-w-0 truncate font-ac-mono text-xs text-ac-text">{r.match.value}</span>
                  <span className="col-span-2 flex min-w-0 items-center gap-2 text-xs text-ac-soft md:col-span-1">
                    →{" "}
                    {a ? (
                      <>
                        <AccountDot color={a.color} size={8} /> {TOOL_LABEL[a.tool]} · {a.name}
                      </>
                    ) : (
                      <>pool {r.target.kind === "pool" ? r.target.pool : ""}</>
                    )}
                    {r.tool !== "any" && <span className="text-ac-faint">({TOOL_LABEL[r.tool]} only)</span>}
                  </span>
                  <span className="hidden text-right font-ac-mono text-[11px] text-ac-faint md:block" title="Matches in the last 7 days">
                    {r.hits == null ? "—" : `${r.hits}×`}
                  </span>
                  <span className="col-start-2 row-start-1 flex justify-end md:col-start-auto md:row-start-auto" title="Pausing a binding isn't supported yet.">
                    <Switch label={`Binding ${r.match.value}`} checked={r.enabled} onChange={() => {}} disabled />
                  </span>
                </div>
              );
            })}
          </RowList>
        </Card>
      </section>

      <section className="flex flex-col gap-2">
        <SectionHeader title="Pools" count={s.pools.length} />
        <div className="grid gap-3 md:grid-cols-2">
          {s.pools.map((p) => (
            <Card key={p.id} className="flex flex-col gap-3 p-4">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-medium text-ac-text">{p.label}</span>
                <span className="text-[11px] text-ac-muted">{p.accountIds.length} accounts</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {p.accountIds.map((id) => {
                  const a = s.accountById(id);
                  return a ? (
                    <button
                      key={id}
                      type="button"
                      onClick={() => s.open({ kind: "account", id })}
                      className="inline-flex h-7 items-center gap-2 rounded-md border border-ac-line px-2 text-xs text-ac-soft hover:border-ac-line2 hover:text-ac-text"
                    >
                      <AccountDot color={a.color} size={8} />
                      {TOOL_LABEL[a.tool]} · {a.name}
                    </button>
                  ) : null;
                })}
              </div>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
