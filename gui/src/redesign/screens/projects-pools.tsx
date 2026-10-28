import { useEffect, useState } from "react";
import { MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { typedFolder, useHomeDir } from "../../lib/paths.js";
import { cn } from "../../lib/utils.js";
import type { DirResolution } from "../../ipc.js";
import { AccountDot } from "../../ui/AccountDot.js";
import { Badge } from "../../ui/Badge.js";
import { Button, IconButton } from "../../ui/Button.js";
import { Card } from "../../ui/Card.js";
import { RowMenu } from "../../ui/RowMenu.js";
import { shortPath } from "../../ui/format.js";
import { Segmented } from "../../ui/Segmented.js";
import { Select } from "../../ui/Select.js";
import { Switch } from "../../ui/Switch.js";
import { TextInput } from "../../ui/TextInput.js";
import { SectionHeader } from "../../ui/Typography.js";
import { accountIdFromMember } from "../../vm/build.js";
import { TOOL_LABEL } from "../../vm/rules.js";
import { useAS } from "../../vm/store.js";
import type { Account, Binding, Pool, Tool } from "../../vm/types.js";
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

/** Tools a folder binding can be made for (Gemini has no backend). */
export const BINDING_TOOLS: Tool[] = ["claude", "codex"];

/** Targets of a new binding for one tool: that tool's accounts, then the pools. */
export function bindingTargets(accounts: readonly Account[], pools: readonly Pool[], tool: Tool): { value: string; label: string }[] {
  return [
    ...accounts.filter((a) => a.tool === tool).map((a) => ({ value: `account:${a.id}`, label: `${TOOL_LABEL[a.tool]} · ${a.name}` })),
    ...pools.map((p) => ({ value: `pool:${p.id}`, label: `Pool · ${p.label}` })),
  ];
}

/** `account:<id>` / `pool:<id>` → the `mapFolder` target. */
export function bindingTarget(value: string, tool: Tool): { accountId: string } | { pool: string; tool: Tool } | null {
  if (value.startsWith("account:")) return { accountId: value.slice("account:".length) };
  if (value.startsWith("pool:")) return { pool: value.slice("pool:".length), tool };
  return null;
}

/** Inline "Add binding" form: folder + tool + account or pool (`agent-switch map`). */
function AddBinding({ initialDir, onDone }: { initialDir: string; onDone: () => void }) {
  const s = useAS();
  const [dir, setDir] = useState(initialDir);
  const [tool, setTool] = useState<Tool>("claude");
  const targets = bindingTargets(s.accounts, s.pools, tool);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const home = useHomeDir();
  const chosen = targets.some((t) => t.value === target) ? target : (targets[0]?.value ?? "");
  const parsed = bindingTarget(chosen, tool);
  const folder = typedFolder(dir, home);
  const problem = !folder.ok && dir.trim() ? folder.reason : null;
  const canSave = folder.ok && !!parsed && !!s.act.mapFolder && !busy;

  const save = () => {
    if (!canSave || !folder.ok || !parsed || !s.act.mapFolder) return;
    setBusy(true);
    s.act
      .mapFolder(folder.path, parsed)
      .then(() => {
        s.toast({ text: `Bound ${shortPath(folder.path)} for ${TOOL_LABEL[tool]}.`, tone: "ok" });
        onDone();
      })
      .catch((e: unknown) => s.toast({ text: `Couldn't add the binding: ${e instanceof Error ? e.message : String(e)}`, tone: "alert" }))
      .finally(() => setBusy(false));
  };

  return (
    <Card className="mb-2 flex flex-col gap-3 p-4" aria-label="Add binding">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-[220px] flex-1 flex-col gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wide text-ac-muted">Folder</span>
          <TextInput
            mono
            autoFocus
            aria-label="Folder to bind"
            placeholder="/full/path/to/project"
            value={dir}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? "add-binding-folder-error" : undefined}
            onChange={(e) => setDir(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              // First Escape clears what was typed; an empty field closes the form.
              if (e.key === "Escape") {
                if (dir) setDir("");
                else onDone();
              }
            }}
          />
          {problem && (
            <span id="add-binding-folder-error" role="alert" className="text-[11px] text-ac-alert-text">
              {problem}
            </span>
          )}
        </label>
        <Segmented label="Binding tool" value={tool} onChange={setTool} options={BINDING_TOOLS.map((t) => ({ value: t, label: TOOL_LABEL[t] }))} />
        <div className="min-w-[200px]">
          <Select
            label="Starts on"
            value={chosen}
            onChange={setTarget}
            disabled={targets.length === 0}
            options={targets.length ? targets : [{ value: "", label: `No ${TOOL_LABEL[tool]} account or pool yet`, disabled: true }]}
          />
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-ac-muted">The folder and its subfolders start on this account — or, for a pool, on its account with the most left.</p>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" disabled={!canSave} onClick={save}>
            Add binding
          </Button>
        </div>
      </div>
    </Card>
  );
}

/** Row ⋯ menu: remove the binding (`agent-switch unmap <folder> --provider P`). */
function BindingMenu({ rule }: { rule: Binding }) {
  const s = useAS();
  const unmap = s.act.unmapFolder;
  if (!unmap) return null;
  return (
    <RowMenu
      items={[
        {
          id: "remove",
          label: "Remove binding",
          icon: <Trash2 />,
          danger: true,
          onSelect: () =>
            s.open({
              kind: "confirm",
              title: "Remove this binding?",
              body: `${shortPath(rule.match.value)} stops starting on its bound ${rule.tool === "any" ? "" : `${TOOL_LABEL[rule.tool]} `}target. You can add it again any time.`,
              confirm: "Remove binding",
              danger: true,
              onConfirm: () => {
                unmap(rule.match.value, rule.tool === "any" ? undefined : rule.tool).catch((e: unknown) =>
                  s.toast({ text: `Couldn't remove the binding: ${e instanceof Error ? e.message : String(e)}`, tone: "alert" }),
                );
              },
            }),
        },
      ]}
      trigger={
        <IconButton label={`Binding menu for ${rule.match.value}`}>
          <MoreHorizontal />
        </IconButton>
      }
    />
  );
}

/** Accounts › Projects & pools. Bundle `VP`. */
export function ProjectsPools() {
  const s = useAS();
  const folders = recentFolders(s.sessions);
  const [dir, setDir] = useState(folders[0] ?? "");
  const [tool, setTool] = useState<Tool>("claude");
  const ex = useExplain(dir, tool);
  const [adding, setAdding] = useState(false);
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
            <Button
              size="sm"
              variant="ghost"
              disabled={!s.act.mapFolder || adding}
              title={s.act.mapFolder ? undefined : "Binding folders isn't available in this window."}
              onClick={() => setAdding(true)}
            >
              <Plus /> Add binding
            </Button>
          }
        />
        <p className="px-1 pb-2 text-xs text-ac-muted">
          First match wins. A binding to a pool lets the pool pick the account with the most left — work and personal never mix.
        </p>
        {adding && <AddBinding initialDir={dir} onDone={() => setAdding(false)} />}
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
                  <span className="col-start-2 row-start-1 flex items-center justify-end gap-2 md:col-start-auto md:row-start-auto">
                    <span title="Pausing a binding isn't supported yet.">
                      <Switch label={`Binding ${r.match.value}`} checked={r.enabled} onChange={() => {}} disabled />
                    </span>
                    <BindingMenu rule={r} />
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
