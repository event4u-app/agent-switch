/**
 * The Changes window, after PhpStorm's Commit tool window (owner, 2026-11-27):
 * three tabs — Changes, Shelf, Stash — a toolbar, the changed files as a tree
 * by folder or a flat list, a checkbox per file and per folder. Rollback,
 * Shelve, Stash and Commit act on the checked files.
 *
 * The Shelf is Agent Switch's own: copies of the files, kept locally, so it
 * works without git too. In a git repository shelving also rolls the files
 * back to HEAD, as PhpStorm's does. In a folder without git a shelf entry is a
 * local snapshot, and the Changes tab lists what changed since the last one
 * (PhpStorm's Local History). Stash is git's own, so only in a repository.
 */
import { useMemo, useState, type ReactNode } from "react";
import { Archive, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Eye, Folder, FolderTree, Layers, List, RefreshCw, Undo2 } from "lucide-react";
import { cn } from "../lib/utils.js";
import { IconButton } from "../ui/Button.js";
import { Segmented } from "../ui/Segmented.js";
import { Act, CheckBox, CountBadge, Tip } from "./kit.js";
import { Window, REVIEW_LATER, type ChangedFile } from "./panels.js";
import { moreFiles } from "./review.js";

/** One git stash: `stash@{n}`, its message, how old, how many files. */
export interface StashEntry {
  ref: string;
  message: string;
  ago: string;
  files: number;
  branch?: string | null;
}

/** One shelf entry: Agent Switch's own copy of some files, kept locally. */
export interface ShelfEntry {
  id: string;
  message: string;
  ago: string;
  files: number;
  /** "git": shelved from a repository (the files were rolled back); "local": a snapshot of a folder without git. */
  kind: "git" | "local";
}

/** Where the changes come from: a git repository (vs HEAD), or a folder without git (vs its last local snapshot). */
export type ChangesSource = { kind: "git" } | { kind: "local"; snapshot: string | null };

export type ChangesOp =
  | { op: "refresh" }
  | { op: "rollback"; files: string[] }
  | { op: "shelve" | "stash"; files: string[]; message: string }
  | { op: "snapshot"; message: string }
  | { op: "stash-apply" | "stash-pop" | "stash-drop"; ref: string }
  | { op: "unshelve" | "shelf-drop"; id: string };

type Tab = "changes" | "shelf" | "stash";

/** A folder of the tree: its full path, its label (single-child chains folded: "src/v3"), its folders and files. */
export interface DirNode {
  path: string;
  label: string;
  dirs: DirNode[];
  files: ChangedFile[];
}

/** The changed files as folders, single-child chains folded into one row, as PhpStorm groups by directory. Pure. */
export function changeTree(files: readonly ChangedFile[]): DirNode {
  const root: DirNode = { path: "", label: "", dirs: [], files: [] };
  for (const f of files) {
    const parts = f.path.split("/");
    let at = root;
    for (const part of parts.slice(0, -1)) {
      const p = at.path ? `${at.path}/${part}` : part;
      let next = at.dirs.find((d) => d.path === p);
      if (!next) at.dirs.push((next = { path: p, label: part, dirs: [], files: [] }));
      at = next;
    }
    at.files.push(f);
  }
  const fold = (d: DirNode): DirNode => {
    let n = d;
    while (n !== root && n.files.length === 0 && n.dirs.length === 1) n = { ...n.dirs[0], label: `${n.label}/${n.dirs[0].label}` };
    return { ...n, dirs: n.dirs.map(fold).sort((a, b) => a.label.localeCompare(b.label)), files: [...n.files].sort((a, b) => a.path.localeCompare(b.path)) };
  };
  return fold(root);
}

const filesUnder = (d: DirNode): string[] => [...d.files.map((f) => f.path), ...d.dirs.flatMap(filesUnder)];
const dirsUnder = (d: DirNode): string[] => d.dirs.flatMap((x) => [x.path, ...dirsUnder(x)]);
const baseName = (p: string) => p.slice(p.lastIndexOf("/") + 1);
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

function StatusLetter({ s }: { s: ChangedFile["status"] }) {
  return <span className={cn("w-3 shrink-0 text-center font-ac-mono", s === "A" || s === "?" ? "text-ac-ok-text" : s === "D" ? "text-ac-alert-text" : "text-ac-info-text")}>{s}</span>;
}

/** An icon in the toolbar: says what it does; disabled, it says why. */
function Tool({ label, why, onClick, children, pressed }: { label: string; why?: string | null; onClick: () => void; children: ReactNode; pressed?: boolean }) {
  return (
    <Tip text={why ? `${label} · ${why}` : label}>
      <IconButton label={label} aria-pressed={pressed} className={cn("size-7 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent", pressed && "bg-ac-raise text-ac-text")} disabled={!!why} onClick={onClick}>
        {children}
      </IconButton>
    </Tip>
  );
}

const sep = <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-ac-line" />;

export function ChangesWindow({
  files,
  more = 0,
  source = { kind: "git" },
  stashes = [],
  shelves = [],
  onReview,
  onCommit,
  onHide,
  onRun,
  reviewAvailable,
  commitAvailable = true,
}: {
  files: ChangedFile[];
  more?: number;
  source?: ChangesSource;
  stashes?: StashEntry[];
  shelves?: ShelfEntry[];
  onReview: (file?: string) => void;
  onCommit: () => void;
  onHide: () => void;
  onRun?: (op: ChangesOp) => void;
  reviewAvailable: boolean;
  commitAvailable?: boolean;
}) {
  const git = source.kind === "git";
  const [tab, setTab] = useState<Tab>("changes");
  const [asTree, setAsTree] = useState(true);
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  // Unchecked, not checked: a file that arrives later is in by default, as in PhpStorm.
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(new Set());
  const [ask, setAsk] = useState<null | { op: "rollback" | "shelve" | "stash" | "snapshot"; message: string }>(null);
  const [confirmDrop, setConfirmDrop] = useState<string | null>(null);
  const tree = useMemo(() => changeTree(files), [files]);
  const checked = files.filter((f) => !unchecked.has(f.path)).map((f) => f.path);
  const added = files.reduce((n, f) => n + f.added, 0);
  const removed = files.reduce((n, f) => n + f.removed, 0);
  const run = (op: ChangesOp) => onRun?.(op);
  const none = checked.length === 0 ? "check files first" : null;
  const noRun = onRun ? null : "arrives with the next version";

  const toggle = (paths: string[], on: boolean) =>
    setUnchecked((u) => {
      const n = new Set(u);
      for (const p of paths) (on ? n.delete(p) : n.add(p));
      return n;
    });
  const allOn = (paths: string[]) => paths.length > 0 && paths.every((p) => !unchecked.has(p));

  const fileRow = (f: ChangedFile, depth: number, flat: boolean) => {
    const dir = flat && f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/") + 1) : "";
    return (
      <div key={f.path} role="treeitem" aria-level={depth + 1} aria-selected={false} className="group mx-1 flex h-6 items-center gap-1.5 rounded-md pr-2 hover:bg-ac-raise" style={{ paddingLeft: 8 + depth * 14 + (asTree ? 14 : 0) }}>
        <CheckBox size={14} checked={!unchecked.has(f.path)} onChange={() => toggle([f.path], unchecked.has(f.path))} label={`Include ${f.path}`} />
        <StatusLetter s={f.status} />
        <button
          type="button"
          aria-label={`Review ${f.path}`}
          disabled={!reviewAvailable}
          title={reviewAvailable ? `${f.path} · open the diff` : REVIEW_LATER}
          onClick={() => onReview(f.path)}
          className="min-w-0 flex-1 truncate text-left font-ac-mono text-[11.5px] enabled:cursor-pointer"
        >
          {dir && <span className="text-ac-faint">{dir}</span>}
          <span className="text-ac-soft">{flat ? f.path.slice(dir.length) : baseName(f.path)}</span>
        </button>
        <span className="shrink-0 font-ac-mono text-[11px] text-ac-ok-text">+{f.added}</span>
        <span className="shrink-0 font-ac-mono text-[11px] text-ac-alert-text">−{f.removed}</span>
      </div>
    );
  };

  const dirRow = (d: DirNode, depth: number): ReactNode => {
    const open = !closed.has(d.path);
    const under = filesUnder(d);
    const on = allOn(under);
    const some = !on && under.some((p) => !unchecked.has(p));
    return (
      <div key={d.path} role="none">
        <div role="treeitem" aria-level={depth + 1} aria-expanded={open} aria-selected={false} className="mx-1 flex h-6 items-center gap-1.5 rounded-md pr-2 hover:bg-ac-raise" style={{ paddingLeft: 8 + depth * 14 }}>
          <button
            type="button"
            aria-label={`${open ? "Collapse" : "Expand"} ${d.path}`}
            onClick={() => setClosed((c) => { const n = new Set(c); open ? n.add(d.path) : n.delete(d.path); return n; })}
            className="-ml-0.5 inline-flex size-3.5 shrink-0 items-center justify-center text-ac-muted"
          >
            {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
          <span className={cn(some && "opacity-60")}>
            <CheckBox size={14} checked={on || some} onChange={() => toggle(under, !on)} label={`Include ${d.path}`} />
          </span>
          <Folder aria-hidden className="size-3.5 shrink-0 text-ac-muted" />
          <span className="min-w-0 flex-1 truncate text-[12px] text-ac-soft">{d.label}</span>
          <span className="shrink-0 text-[11px] text-ac-faint">{under.length}</span>
        </div>
        {open && (
          <div role="group">
            {d.dirs.map((x) => dirRow(x, depth + 1))}
            {d.files.map((f) => fileRow(f, depth + 1, false))}
          </div>
        )}
      </div>
    );
  };

  const toolbar = (
    <div role="toolbar" aria-label="Changes" className="flex h-9 shrink-0 items-center gap-0.5 border-b border-ac-line px-2">
      <Tool label="Refresh" why={noRun} onClick={() => run({ op: "refresh" })}>
        <RefreshCw />
      </Tool>
      <Tool label={git ? `Roll back ${plural(checked.length, "file")}…` : `Restore ${plural(checked.length, "file")} from the snapshot…`} why={noRun ?? none ?? (!git && !source.snapshot ? "no snapshot yet" : null)} onClick={() => setAsk({ op: "rollback", message: "" })}>
        <Undo2 />
      </Tool>
      <Tool label={`Shelve ${plural(checked.length, "file")}…`} why={noRun ?? none} onClick={() => setAsk({ op: "shelve", message: "" })}>
        <Archive />
      </Tool>
      <Tool label={`Stash ${plural(checked.length, "file")}…`} why={noRun ?? (git ? none : "not a git repository; the Shelf works here")} onClick={() => setAsk({ op: "stash", message: "" })}>
        <Layers />
      </Tool>
      <Tool label="Show diff" why={reviewAvailable ? null : REVIEW_LATER} onClick={() => onReview()}>
        <Eye />
      </Tool>
      <span className="ml-auto" />
      <Tool label={asTree ? "Show as a flat list" : "Group by folder"} pressed={asTree} onClick={() => setAsTree((t) => !t)}>
        {asTree ? <FolderTree /> : <List />}
      </Tool>
      {sep}
      <Tool label="Expand all" why={asTree ? null : "only in the folder tree"} onClick={() => setClosed(new Set())}>
        <ChevronsUpDown />
      </Tool>
      <Tool label="Collapse all" why={asTree ? null : "only in the folder tree"} onClick={() => setClosed(new Set(dirsUnder(tree)))}>
        <ChevronsDownUp />
      </Tool>
    </div>
  );

  const submit = () => {
    if (!ask) return;
    if (ask.op === "rollback") run({ op: "rollback", files: checked });
    else if (ask.op === "snapshot") run({ op: "snapshot", message: ask.message });
    else run({ op: ask.op, files: checked, message: ask.message });
    setAsk(null);
  };
  const askBox = ask && (
    <form
      aria-label={ask.op === "rollback" ? "Confirm roll back" : ask.op}
      onSubmit={(e) => (e.preventDefault(), submit())}
      className="mx-2.5 mt-2 flex flex-col gap-2 rounded-md border border-ac-line2 bg-ac-raise p-2.5"
    >
      {ask.op === "rollback" ? (
        <p className="text-xs text-ac-soft">
          {git ? `Roll back ${plural(checked.length, "file")} to HEAD? Their changes are lost; Shelve keeps a copy first.` : `Restore ${plural(checked.length, "file")} from the last snapshot? Their current content is lost.`}
        </p>
      ) : (
        <label className="flex flex-col gap-1 text-[11px] text-ac-muted">
          {ask.op === "shelve" ? (git ? "Shelve: keep a local copy, then roll the files back" : "Shelve: keep a local snapshot of the files") : ask.op === "stash" ? "Stash message" : "Snapshot name"}
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <input autoFocus value={ask.message} onChange={(e) => setAsk({ ...ask, message: e.target.value })} placeholder={ask.op === "stash" ? "WIP" : "What this is"} className="h-7 rounded-md border border-ac-line2 bg-ac-bg px-2 text-xs text-ac-text placeholder:text-ac-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ac-brand-line" />
        </label>
      )}
      <div className="flex gap-2">
        <Act kind={ask.op === "rollback" ? "danger" : "accent"} onClick={submit}>
          {ask.op === "rollback" ? (git ? "Roll back" : "Restore") : ask.op === "shelve" ? "Shelve" : ask.op === "stash" ? "Stash" : "Take snapshot"}
        </Act>
        <Act onClick={() => setAsk(null)}>Cancel</Act>
      </div>
    </form>
  );

  const changesTab = (
    <>
      {toolbar}
      {askBox}
      <div className="flex h-8 shrink-0 items-center gap-2 pl-3 pr-3.5 text-xs text-ac-soft">
        <CheckBox size={14} checked={allOn(files.map((f) => f.path))} onChange={() => toggle(files.map((f) => f.path), !allOn(files.map((f) => f.path)))} label="Include all files" />
        <span>
          {checked.length === files.length ? plural(files.length + more, "file") : `${checked.length} of ${plural(files.length + more, "file")}`} · <span className="text-ac-ok-text">+{added}</span> <span className="text-ac-alert-text">−{removed}</span>
        </span>
        <span className="ml-auto text-[11px] text-ac-muted">{git ? "vs HEAD" : source.snapshot ? `vs snapshot ${source.snapshot}` : "no snapshot yet"}</span>
      </div>
      {!git && !source.snapshot ? (
        <div className="px-3.5 py-2 text-xs leading-relaxed text-ac-muted">
          <p>Not a git repository. Agent Switch can keep local snapshots of this folder: the first one is the base, and this list then shows what changed since.</p>
          {!ask && (
          <div className="mt-2.5">
            <Act kind="accent" disabled={!!noRun} title={noRun ?? undefined} onClick={() => setAsk({ op: "snapshot", message: "" })}>
              Take snapshot
            </Act>
          </div>
          )}
        </div>
      ) : files.length === 0 ? (
        <p className="px-3.5 py-2 text-xs text-ac-muted">No changes.</p>
      ) : (
        <div role="tree" aria-label="Changed files" className="pb-1">
          {asTree ? (
            <>
              {tree.dirs.map((d) => dirRow(d, 0))}
              {tree.files.map((f) => fileRow(f, 0, false))}
            </>
          ) : (
            [...files].sort((a, b) => a.path.localeCompare(b.path)).map((f) => fileRow(f, 0, true))
          )}
        </div>
      )}
      {more > 0 && <p className="px-3.5 pt-1.5 text-[11px] text-ac-muted">{moreFiles(more)}</p>}
      <div className="flex gap-2 px-3.5 py-3">
        <Act kind="accent" onClick={() => onReview()} disabled={!reviewAvailable} title={reviewAvailable ? undefined : REVIEW_LATER}>
          Review changes
        </Act>
        {git && (
          <Act onClick={onCommit} disabled={!commitAvailable || checked.length === 0} title={!commitAvailable ? "Commit arrives with the next version" : checked.length === 0 ? "Check files first" : undefined}>
            Commit…
          </Act>
        )}
      </div>
    </>
  );

  const entryRow = (key: string, title: string, meta: string, actions: ReactNode) => (
    <div key={key} className="group relative mx-1 flex min-h-[44px] flex-col justify-center gap-0.5 rounded-md px-2.5 py-1.5 hover:bg-ac-raise focus-within:bg-ac-raise">
      <span className="truncate text-xs text-ac-text">{title}</span>
      <span className="truncate text-[11px] text-ac-muted">{meta}</span>
      {/* The entry's actions show over it on hover or focus, as PhpStorm keeps its lists quiet: the title keeps the full width. */}
      <span className="absolute inset-y-0 right-1.5 flex items-center gap-1 bg-[linear-gradient(to_right,transparent,var(--ac-raise)_16px)] pl-5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">{actions}</span>
    </div>
  );

  const dropAsk = (id: string, what: string, drop: () => void) =>
    confirmDrop === id && (
      <div key={`${id}-ask`} className="mx-2.5 mb-1.5 flex items-center gap-2 rounded-md border border-ac-line2 bg-ac-raise px-2.5 py-2 text-xs text-ac-soft">
        <span className="mr-auto">Delete {what}? It cannot be undone.</span>
        <Act kind="danger" onClick={() => (drop(), setConfirmDrop(null))}>
          Delete
        </Act>
        <Act onClick={() => setConfirmDrop(null)}>Cancel</Act>
      </div>
    );

  const shelfTab = (
    <div className="py-1.5">
      <p className="px-3.5 pb-1.5 text-[11px] leading-relaxed text-ac-muted">{git ? "Local copies Agent Switch keeps; shelving rolled the files back. Unshelve puts them back into the folder." : "Local snapshots of this folder, kept by Agent Switch. Restore puts a snapshot's files back."}</p>
      {shelves.length === 0 && <p className="px-3.5 py-1 text-xs text-ac-muted">Nothing shelved.</p>}
      {shelves.map((s) => [
        entryRow(
          s.id,
          s.message || "(no message)",
          `${plural(s.files, "file")} · ${s.ago}${s.kind === "local" ? " · snapshot" : ""}`,
          <>
            <Act kind="accent" disabled={!!noRun} title={noRun ?? `Put the ${plural(s.files, "file")} back; the current content of the same files is replaced`} onClick={() => run({ op: "unshelve", id: s.id })}>
              {s.kind === "local" ? "Restore" : "Unshelve"}
            </Act>
            <Act disabled={!!noRun} title={noRun ?? "Delete this entry"} onClick={() => setConfirmDrop(s.id)}>
              Delete
            </Act>
          </>,
        ),
        dropAsk(s.id, `“${s.message || s.id}”`, () => run({ op: "shelf-drop", id: s.id })),
      ])}
    </div>
  );

  const stashTab = (
    <div className="py-1.5">
      {stashes.length === 0 && <p className="px-3.5 py-1 text-xs text-ac-muted">No stashes.</p>}
      {stashes.map((s) => [
        entryRow(
          s.ref,
          s.message,
          `${s.ref} · ${plural(s.files, "file")} · ${s.ago}${s.branch ? ` · on ${s.branch}` : ""}`,
          <>
            <Act kind="accent" disabled={!!noRun} title={noRun ?? "Apply and keep the stash"} onClick={() => run({ op: "stash-apply", ref: s.ref })}>
              Apply
            </Act>
            <Act disabled={!!noRun} title={noRun ?? "Apply and remove the stash"} onClick={() => run({ op: "stash-pop", ref: s.ref })}>
              Pop
            </Act>
            <Act disabled={!!noRun} title={noRun ?? "Delete the stash"} onClick={() => setConfirmDrop(s.ref)}>
              Drop
            </Act>
          </>,
        ),
        dropAsk(s.ref, s.ref, () => run({ op: "stash-drop", ref: s.ref })),
      ])}
    </div>
  );

  return (
    <Window title="Changes" aside={git ? "git" : "local"} onHide={onHide}>
      <div className="px-2.5 pb-1 pt-2.5">
        <Segmented<Tab>
          label="Changes view"
          size="xs"
          fill
          dense
          value={tab}
          onChange={setTab}
          options={[
            { value: "changes", label: <>Changes <CountBadge n={files.length + more} /></> },
            { value: "shelf", label: <>Shelf <CountBadge n={shelves.length} /></> },
            { value: "stash", label: git ? <>Stash <CountBadge n={stashes.length} /></> : "Stash", disabled: !git, why: "Not a git repository: the Shelf keeps local copies here" },
          ]}
        />
      </div>
      {tab === "changes" ? changesTab : tab === "shelf" ? shelfTab : stashTab}
    </Window>
  );
}
