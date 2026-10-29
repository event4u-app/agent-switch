import { useEffect, useState } from "react";
import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
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
import { PoolsSection } from "./pools-panel.js";
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

/** The form's `account:<id>` / `pool:<id>` value for a binding's target. */
const targetValue = (b: Binding) => (b.target.kind === "account" ? `account:${b.target.accountId}` : `pool:${b.target.pool}`);

/** Inline binding form: folder + tool + account or pool (`agent-switch map`).
 *  With `editing` it changes that binding: the same folder and tool are simply
 *  mapped again (a paused rule stays paused); a new folder or tool is mapped,
 *  the old rule removed, and a paused binding paused again in its new place. */
function BindingForm({ initialDir, editing, onDone }: { initialDir: string; editing?: Binding; onDone: () => void }) {
  const s = useAS();
  const [dir, setDir] = useState(editing?.match.value ?? initialDir);
  const [tool, setTool] = useState<Tool>(editing && editing.tool !== "any" ? editing.tool : "claude");
  const targets = bindingTargets(s.accounts, s.pools, tool);
  const [target, setTarget] = useState(editing ? targetValue(editing) : "");
  const [busy, setBusy] = useState(false);
  const home = useHomeDir();
  const chosen = targets.some((t) => t.value === target) ? target : (targets[0]?.value ?? "");
  const parsed = bindingTarget(chosen, tool);
  const folder = typedFolder(dir, home);
  const problem = !folder.ok && dir.trim() ? folder.reason : null;
  const canSave = folder.ok && !!parsed && !!s.act.mapFolder && !busy;

  const write = async (path: string, to: NonNullable<typeof parsed>) => {
    await s.act.mapFolder!(path, to);
    if (!editing) return;
    const moved = path !== editing.match.value || tool !== editing.tool;
    if (!moved) return;
    await s.act.unmapFolder?.(editing.match.value, editing.tool === "any" ? undefined : editing.tool);
    if (!editing.enabled) await s.act.setBindingPaused?.(path, tool, true);
  };

  const save = () => {
    if (!canSave || !folder.ok || !parsed || !s.act.mapFolder) return;
    setBusy(true);
    write(folder.path, parsed)
      .then(() => {
        s.toast({ text: editing ? `Binding for ${shortPath(folder.path)} saved.` : `Bound ${shortPath(folder.path)} for ${TOOL_LABEL[tool]}.`, tone: "ok" });
        onDone();
      })
      .catch((e: unknown) =>
        s.toast({ text: `Couldn't ${editing ? "save" : "add"} the binding: ${e instanceof Error ? e.message : String(e)}`, tone: "alert" }),
      )
      .finally(() => setBusy(false));
  };

  return (
    <Card className="mb-2 flex flex-col gap-3 p-4" aria-label={editing ? "Edit binding" : "Add binding"}>
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
            {editing ? "Save binding" : "Add binding"}
          </Button>
        </div>
      </div>
    </Card>
  );
}

/** Row ⋯ menu: edit the binding inline, or remove it (`agent-switch unmap <folder> --provider P`). */
function BindingMenu({ rule, onEdit }: { rule: Binding; onEdit: () => void }) {
  const s = useAS();
  const unmap = s.act.unmapFolder;
  if (!unmap && !s.act.mapFolder) return null;
  return (
    <RowMenu
      items={[
        { id: "edit", label: "Edit binding", icon: <Pencil />, disabled: !s.act.mapFolder, onSelect: onEdit },
        {
          id: "remove",
          label: "Remove binding",
          icon: <Trash2 />,
          danger: true,
          disabled: !unmap,
          onSelect: () =>
            s.open({
              kind: "confirm",
              title: "Remove this binding?",
              body: `${shortPath(rule.match.value)} stops starting on its bound ${rule.tool === "any" ? "" : `${TOOL_LABEL[rule.tool]} `}target. You can add it again any time.`,
              confirm: "Remove binding",
              danger: true,
              onConfirm: () => {
                unmap?.(rule.match.value, rule.tool === "any" ? undefined : rule.tool)?.catch((e: unknown) =>
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
  const [picked, setPicked] = useState(folders[0] ?? "");
  const [typed, setTyped] = useState("");
  const home = useHomeDir();
  const typedDir = typedFolder(typed, home);
  const dir = typed.trim() ? (typedDir.ok ? typedDir.path : "") : picked;
  const [tool, setTool] = useState<Tool>("claude");
  const ex = useExplain(dir, tool);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const togglePaused = (r: Binding) => {
    if (r.tool === "any" || !s.act.setBindingPaused) return;
    s.act
      .setBindingPaused(r.match.value, r.tool, r.enabled)
      .catch((e: unknown) => s.toast({ tone: "alert", text: `Couldn't ${r.enabled ? "pause" : "resume"} the binding: ${e instanceof Error ? e.message : String(e)}` }));
  };
  const account = ex.state === "done" ? s.accountById(accountIdFromMember(ex.res.profile) ?? "") : undefined;
  const why = ex.state === "done" ? ex.res.why : ex.state === "error" ? [ex.message] : [];

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <Select
              label="Try a folder"
              mono
              value={picked}
              onChange={(v) => {
                setPicked(v);
                setTyped("");
              }}
              options={folders.map((f) => ({ value: f, label: shortPath(f) }))}
            />
          </div>
          <div className="flex min-w-[200px] flex-1 flex-col gap-1.5">
            <label className="ac-caps" htmlFor="try-folder">
              Or type a folder
            </label>
            <TextInput id="try-folder" mono className="h-9" placeholder="~/projects/…" value={typed} onChange={(e) => setTyped(e.target.value)} />
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
                "No folder to try yet — type one, or pick one once a session ran in it."
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
          The nearest bound folder wins. Bind to an account to always start there, or to a pool to let its accounts share the work — work and personal never mix.
        </p>
        {adding && <BindingForm initialDir={dir} onDone={() => setAdding(false)} />}
        <Card className="p-1">
          <RowList>
            {s.rules.map((r) => {
              const a = r.target.kind === "account" ? s.accountById(r.target.accountId) : undefined;
              if (editing === r.id) return <BindingForm key={r.id} initialDir={dir} editing={r} onDone={() => setEditing(null)} />;
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
                      <>pool {r.target.kind === "pool" ? (s.pools.find((p) => p.id === (r.target as { pool: string }).pool)?.label ?? r.target.pool) : ""}</>
                    )}
                    {r.tool !== "any" && <span className="text-ac-faint">({TOOL_LABEL[r.tool]} only)</span>}
                  </span>
                  <span className="hidden text-right font-ac-mono text-[11px] text-ac-faint md:block" title="Matches in the last 7 days">
                    {r.hits == null ? "—" : `${r.hits}×`}
                  </span>
                  <span className="col-start-2 row-start-1 flex items-center justify-end gap-2 md:col-start-auto md:row-start-auto">
                    <span title={r.enabled ? "On — pause to keep the binding but stop using it" : "Paused — starts here ignore it until you turn it back on"}>
                      <Switch
                        label={`Binding ${r.match.value}`}
                        checked={r.enabled}
                        disabled={!s.act.setBindingPaused || r.tool === "any"}
                        onChange={() => togglePaused(r)}
                      />
                    </span>
                    <BindingMenu rule={r} onEdit={() => setEditing(r.id)} />
                  </span>
                </div>
              );
            })}
          </RowList>
        </Card>
      </section>

      <PoolsSection />
    </div>
  );
}
