import { useState } from "react";
import { MoreHorizontal, Pencil, Plus, Trash2, X } from "lucide-react";
import { cn } from "../../lib/utils.js";
import { AccountDot } from "../../ui/AccountDot.js";
import { Button, IconButton } from "../../ui/Button.js";
import { Card, EmptyState } from "../../ui/Card.js";
import { RowMenu } from "../../ui/RowMenu.js";
import { TextInput } from "../../ui/TextInput.js";
import { SectionHeader } from "../../ui/Typography.js";
import { TOOL_LABEL } from "../../vm/rules.js";
import { useAS, type Store } from "../../vm/store.js";
import type { Account, Pool } from "../../vm/types.js";

const label = (a: Account) => `${TOOL_LABEL[a.tool]} · ${a.name}`;

function failed(s: Store, what: string) {
  return (e: unknown) => s.toast({ tone: "alert", text: `${what}: ${e instanceof Error ? e.message : String(e)}` });
}

/** New pool: a name and its accounts (`pool create` + `pool add`). */
function NewPool({ onDone }: { onDone: () => void }) {
  const s = useAS();
  const [name, setName] = useState("");
  const [members, setMembers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const accounts = s.accounts.filter((a) => a.tool !== "gemini" && !a.disabled);
  const can = !!name.trim() && !busy && !!s.act.createPool;

  async function create() {
    if (!can || !s.act.createPool) return;
    setBusy(true);
    try {
      const id = await s.act.createPool(name.trim());
      for (const m of members) await s.act.setPoolMembership?.(id, m, true);
      s.toast({ tone: "ok", text: `Pool ${name.trim()} created.` });
      onDone();
    } catch (e) {
      failed(s, "Couldn't create the pool")(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-col gap-1.5">
        <label className="ac-caps" htmlFor="new-pool-name">
          Pool name
        </label>
        <TextInput
          id="new-pool-name"
          autoFocus
          className="h-9"
          placeholder="e.g. Work accounts"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void create();
            if (e.key === "Escape") onDone();
          }}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="ac-caps">Accounts in it</span>
        <div className="flex flex-wrap gap-1.5">
          {accounts.map((a) => {
            const on = members.includes(a.id);
            return (
              <label
                key={a.id}
                className={cn(
                  "inline-flex h-7 cursor-pointer items-center gap-2 rounded-md border px-2 text-xs transition-colors",
                  on ? "border-ac-brand-line bg-ac-brand-tint text-ac-text" : "border-ac-line text-ac-soft hover:border-ac-line2",
                )}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={on}
                  onChange={() => setMembers((m) => (on ? m.filter((x) => x !== a.id) : [...m, a.id]))}
                />
                <AccountDot color={a.color} size={8} />
                {label(a)}
              </label>
            );
          })}
        </div>
        <span className="text-[11px] text-ac-faint">You can change the accounts later on the pool.</span>
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" disabled={!can} onClick={() => void create()}>
          Create pool
        </Button>
      </div>
    </Card>
  );
}

function PoolCard({ pool }: { pool: Pool }) {
  const s = useAS();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(pool.label);
  const members = pool.accountIds.map((id) => s.accountById(id)).filter((a): a is Account => !!a);
  const others = s.accounts.filter((a) => a.tool !== "gemini" && !a.disabled && !pool.accountIds.includes(a.id));
  const setMember = (a: Account, on: boolean) =>
    s.act.setPoolMembership?.(pool.id, a.id, on).catch(failed(s, on ? `Couldn't add ${a.name}` : `Couldn't remove ${a.name}`));

  const rename = () => {
    const next = name.trim();
    setRenaming(false);
    if (next && next !== pool.label) s.act.renamePool?.(pool.id, next).catch(failed(s, "Couldn't rename the pool"));
  };

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        {renaming ? (
          <TextInput
            aria-label="Pool name"
            autoFocus
            className="h-8"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={rename}
            onKeyDown={(e) => {
              if (e.key === "Enter") rename();
              if (e.key === "Escape") {
                setName(pool.label);
                setRenaming(false);
              }
            }}
          />
        ) : (
          <span className="text-[13px] font-medium text-ac-text">{pool.label}</span>
        )}
        <span className="flex items-center gap-1">
          <span className="text-[11px] text-ac-muted">
            {members.length} account{members.length === 1 ? "" : "s"}
          </span>
          <RowMenu
            items={[
              { id: "rename", label: "Rename", icon: <Pencil />, disabled: !s.act.renamePool, onSelect: () => setRenaming(true) },
              {
                id: "delete",
                label: "Delete pool …",
                icon: <Trash2 />,
                danger: true,
                disabled: !s.act.deletePool,
                onSelect: () =>
                  s.open({
                    kind: "confirm",
                    title: `Delete pool ${pool.label}?`,
                    body: "Its accounts stay as they are. A folder that still points at the pool must be unbound first — you'll be told which.",
                    confirm: "Delete pool",
                    danger: true,
                    onConfirm: () => {
                      s.act.deletePool?.(pool.id).catch(failed(s, "Couldn't delete the pool"));
                    },
                  }),
              },
            ]}
            trigger={
              <IconButton label={`More for pool ${pool.label}`}>
                <MoreHorizontal />
              </IconButton>
            }
          />
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {members.map((a) => (
          <span key={a.id} className="inline-flex h-7 items-center rounded-md border border-ac-line text-xs text-ac-soft">
            <button type="button" className="inline-flex h-full items-center gap-2 pl-2 pr-1 hover:text-ac-text" onClick={() => s.open({ kind: "account", id: a.id })}>
              <AccountDot color={a.color} size={8} />
              {label(a)}
            </button>
            <button
              type="button"
              aria-label={`Remove ${label(a)} from ${pool.label}`}
              title={`Remove from ${pool.label}`}
              disabled={!s.act.setPoolMembership}
              className="inline-flex h-full items-center px-1.5 text-ac-faint hover:text-ac-alert-text [&_svg]:size-3"
              onClick={() => void setMember(a, false)}
            >
              <X />
            </button>
          </span>
        ))}
        {others.map((a) => (
          <button
            key={a.id}
            type="button"
            aria-label={`Add ${label(a)} to ${pool.label}`}
            disabled={!s.act.setPoolMembership}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-dashed border-ac-line px-2 text-xs text-ac-faint hover:border-ac-line2 hover:text-ac-soft [&_svg]:size-3"
            onClick={() => void setMember(a, true)}
          >
            <Plus /> {label(a)}
          </button>
        ))}
      </div>
    </Card>
  );
}

/** Pools: named groups of accounts a folder binding can point at. */
export function PoolsSection() {
  const s = useAS();
  const [adding, setAdding] = useState(false);
  const newButton = (
    <Button size="sm" variant="ghost" disabled={!s.act.createPool || adding} onClick={() => setAdding(true)}>
      <Plus /> New pool
    </Button>
  );
  return (
    <section className="flex flex-col gap-2">
      <SectionHeader title="Pools" count={s.pools.length} actions={newButton} />
      <p className="px-1 text-xs text-ac-muted">
        Without a binding a start is spread over all your accounts. A pool narrows that for a folder — bind it to the pool and only its accounts take
        the start, the one with the most to lose before its reset first.
      </p>
      {adding && <NewPool onDone={() => setAdding(false)} />}
      {s.pools.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {s.pools.map((p) => (
            <PoolCard key={p.id} pool={p} />
          ))}
        </div>
      ) : (
        !adding && (
          <EmptyState
            title="No pools yet"
            detail="For example “Work” with your company accounts: bind your work folders to it, and private accounts are never used there."
            action={
              <Button size="sm" disabled={!s.act.createPool} onClick={() => setAdding(true)}>
                <Plus /> New pool
              </Button>
            }
          />
        )
      )}
    </section>
  );
}
