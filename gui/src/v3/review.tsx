/** v3.1 Review page (spec §10.9), adapted from the reference board `v31.tsx`:
 *  scope This turn / Session / Worktree vs main / Staged, Unified / Split, the
 *  file tree with the Marker, per-file and per-hunk stage / discard (locked
 *  while a turn runs), line comments sent as the next prompt, Commit and PR. */

import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, MessageSquare, SquareTerminal, TriangleAlert, Undo2 } from "lucide-react";

import { cn } from "../lib/utils.js";
import { Badge } from "../ui/Badge.js";
import { Button } from "../ui/Button.js";
import { Segmented } from "../ui/Segmented.js";
import { Act, Marker, PageHeader } from "./kit.js";
import { DiffLines } from "./chat.js";
import { PageBody } from "./pages.js";
import { SessionStateIcon } from "../ui/SessionStateIcon.js";
import type { ReviewFileJson, ReviewHunkJson, ReviewScope } from "../ipc.js";

export interface ReviewActions {
  setScope: (s: ReviewScope) => void;
  stage: (file: string, hunk?: string) => void;
  unstage: (file: string, hunk?: string) => void;
  discard: (file: string, hunk?: string) => void;
  undo: () => void;
  /** Queue a line comment as the next prompt; absent when the session has no chat writer here. */
  comment?: (text: string) => void;
  commit: () => void;
  createPr: () => void;
  /** Codex only: ask the agent for a review of these changes. */
  agentReview?: () => void;
}

const LOCKED = "Unlocks when the turn ends";
const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : ".");
const nameOf = (p: string) => p.slice(p.lastIndexOf("/") + 1);
const STATUS_TONE: Record<ReviewFileJson["status"], string> = { A: "text-ac-ok-text", "?": "text-ac-ok-text", D: "text-ac-alert-text", M: "text-ac-info-text", R: "text-ac-info-text" };

/** Old and new side by side. Pure rendering. */
function SplitLines({ hunks }: { hunks: { oldStart: number; newStart: number; lines: string[] }[] }) {
  const rows: { l: [number | null, string, string] | null; r: [number | null, string, string] | null }[] = [];
  for (const h of hunks) {
    let o = h.oldStart;
    let n = h.newStart;
    let dels: [number, string][] = [];
    let adds: [number, string][] = [];
    const flush = () => {
      for (let i = 0; i < Math.max(dels.length, adds.length); i++) rows.push({ l: dels[i] ? [dels[i][0], "-", dels[i][1]] : null, r: adds[i] ? [adds[i][0], "+", adds[i][1]] : null });
      dels = [];
      adds = [];
    };
    for (const l of h.lines) {
      if (l.startsWith("-")) dels.push([o++, l.slice(1)]);
      else if (l.startsWith("+")) adds.push([n++, l.slice(1)]);
      else {
        flush();
        rows.push({ l: [o++, " ", l.slice(1)], r: [n++, " ", l.slice(1)] });
      }
    }
    flush();
  }
  const cell = (c: [number | null, string, string] | null, side: "l" | "r") => (
    <div className="flex min-w-0 whitespace-pre px-3" style={{ background: c?.[1] === "+" ? "var(--as-diff-add-line)" : c?.[1] === "-" ? "var(--as-diff-del-line)" : undefined }}>
      <span className="w-8 shrink-0 select-none text-right text-ac-faint">{c?.[0] ?? ""}</span>
      <span className={cn("w-4 shrink-0 select-none text-center", side === "r" ? "text-ac-ok-text" : "text-ac-alert-text")}>{c && c[1] !== " " ? c[1] : ""}</span>
      <span className="min-w-0 overflow-hidden text-ellipsis text-ac-soft">{c?.[2] ?? ""}</span>
    </div>
  );
  return (
    <div className="grid grid-cols-2 font-ac-mono text-[11.5px] leading-[1.55]">
      {rows.map((row, i) => (
        <div key={i} className="contents">
          {cell(row.l, "l")}
          {cell(row.r, "r")}
        </div>
      ))}
    </div>
  );
}

function HunkView({ file, h, layout, running, on }: { file: string; h: ReviewHunkJson; layout: "unified" | "split"; running: boolean; on: ReviewActions }) {
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const acts: ReactNode[] = [];
  if (h.layer === "unstaged")
    acts.push(
      <Button key="s" size="sm" variant="ghost" disabled={running} title={running ? LOCKED : undefined} onClick={() => on.stage(file, h.hash)}>
        Stage hunk
      </Button>,
      <Button key="d" size="sm" variant="ghost" disabled={running} title={running ? LOCKED : undefined} onClick={() => on.discard(file, h.hash)}>
        Discard hunk
      </Button>,
    );
  if (h.layer === "staged")
    acts.push(
      <Button key="u" size="sm" variant="ghost" disabled={running} title={running ? LOCKED : undefined} onClick={() => on.unstage(file, h.hash)}>
        Unstage hunk
      </Button>,
    );
  const firstNew = h.newStart;
  return (
    <>
      <div className="flex items-center gap-2 border-b border-ac-line bg-ac-rail px-3 py-1 font-ac-mono text-[11px] text-ac-muted">
        <span className="min-w-0 truncate">{h.header}</span>
        <span className="shrink-0 font-sans text-[10.5px] text-ac-faint">{h.layer === "committed" ? "committed" : h.layer === "turn" ? "this turn" : h.layer}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5 font-sans">
          {acts}
          <Button size="sm" variant="ghost" disabled={!on.comment} title={on.comment ? undefined : "Open the chat view to send comments to the session"} onClick={() => setWriting((v) => !v)}>
            <MessageSquare /> Comment → next prompt
          </Button>
        </span>
      </div>
      {layout === "split" ? <SplitLines hunks={[h]} /> : <DiffLines hunks={[h]} />}
      {(writing || sent) && (
        <div className="border-t border-ac-line bg-ac-bg px-3 py-2">
          {sent ? (
            <>
              <div className="rounded-md border border-ac-brand-line bg-ac-panel px-2.5 py-1.5 text-xs text-ac-soft">
                <span className="text-ac-brand-text">Line {firstNew} · </span>
                {sent}
              </div>
              <div className="mt-1.5 flex items-center gap-2 text-[11px] text-ac-muted">
                <Badge tone="brand">queued as next prompt</Badge>
                <span>sent when the turn ends</span>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <input
                aria-label={`Comment on ${file} line ${firstNew}`}
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && text.trim()) {
                    on.comment?.(`In ${file}, line ${firstNew}: ${text.trim()}`);
                    setSent(text.trim());
                    setWriting(false);
                  }
                }}
                placeholder="Say what should change here — sent when the turn ends"
                className="h-7 min-w-0 flex-1 rounded-md border border-ac-line2 bg-ac-panel px-2 text-xs text-ac-text outline-none"
              />
            </div>
          )}
        </div>
      )}
    </>
  );
}

function FileCard({ f, open, onToggle, layout, running, on }: { f: ReviewFileJson; open: boolean; onToggle: () => void; layout: "unified" | "split"; running: boolean; on: ReviewActions }) {
  const unstaged = f.hunks.some((h) => h.layer === "unstaged");
  return (
    <div className="overflow-hidden rounded-[10px] border border-ac-line bg-ac-panel">
      <div className="flex items-center gap-2 border-b border-ac-line px-3 py-2">
        <button type="button" aria-expanded={open} aria-label={open ? `Collapse ${f.path}` : `Expand ${f.path}`} onClick={onToggle} className="text-ac-faint">
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </button>
        <span className="min-w-0 truncate font-ac-mono text-xs text-ac-text">{f.path}</span>
        <span className="shrink-0 font-ac-mono text-[11px] text-ac-ok-text">+{f.added}</span>
        <span className="shrink-0 font-ac-mono text-[11px] text-ac-alert-text">−{f.removed}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <Button size="sm" disabled={running || !unstaged} title={running ? LOCKED : undefined} onClick={() => on.stage(f.path)}>
            Stage file
          </Button>
          <Button size="sm" variant="danger" disabled={running || !unstaged} title={running ? LOCKED : undefined} onClick={() => on.discard(f.path)}>
            Discard
          </Button>
        </span>
      </div>
      {open &&
        f.hunks.map((h) => (
          <HunkView key={`${h.layer}-${h.hash}`} file={f.path} h={h} layout={layout} running={running} on={on} />
        ))}
    </div>
  );
}

export function Review({
  title,
  scope,
  files,
  shared,
  running,
  loading,
  error,
  undoable,
  on,
}: {
  title: string;
  scope: ReviewScope;
  files: ReviewFileJson[];
  shared: string[];
  running: boolean;
  loading: boolean;
  error: string | null;
  undoable: boolean;
  on: ReviewActions;
}) {
  const [layout, setLayout] = useState<"unified" | "split">("unified");
  const [current, setCurrent] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const staged = useMemo(() => files.filter((f) => f.hunks.some((h) => h.layer === "staged")).length, [files]);
  const dirs = [...new Set(files.map((f) => dirOf(f.path)))];
  const shown = current ?? files[0]?.path ?? null;
  return (
    <PageBody>
      <PageHeader
        eyebrow={`Review · ${title}`}
        title="Changes"
        actions={
          <div className="flex items-center gap-2">
            <Segmented<ReviewScope>
              size="sm"
              label="Scope"
              value={scope}
              onChange={on.setScope}
              options={[
                { value: "turn", label: "This turn" },
                { value: "session", label: "Session" },
                { value: "worktree", label: "Worktree vs main" },
                { value: "staged", label: "Staged" },
              ]}
            />
            <Segmented<"unified" | "split"> size="sm" label="Layout" value={layout} onChange={setLayout} options={[{ value: "unified", label: "Unified" }, { value: "split", label: "Split" }]} />
          </div>
        }
      />
      <div className="mb-3 flex items-center gap-2 rounded-[10px] border border-ac-line bg-ac-panel px-3 py-2 text-xs text-ac-muted">
        {running ? (
          <span className="inline-flex items-center gap-1.5 text-ac-warn-text">
            <SessionStateIcon state="working" /> A turn is running — stage and discard unlock when it ends
          </span>
        ) : (
          <span>{loading ? "Reading the changes…" : `${files.length} ${files.length === 1 ? "file" : "files"} changed`}</span>
        )}
        <span className="ml-auto">Includes changes made through Bash (git diff), not only Edit events</span>
      </div>
      {shared.length > 0 && (
        <div role="status" className="mb-3 flex items-center gap-2 rounded-[10px] border border-ac-warn bg-ac-warn-tint px-3 py-2 text-xs text-ac-warn-text">
          <TriangleAlert className="size-3.5" /> {shared.length === 1 ? "Another session works" : `${shared.length} other sessions work`} in this worktree — staging and discarding change their files too.
        </div>
      )}
      {error && (
        <div role="alert" className="mb-3 rounded-[10px] border border-ac-alert bg-ac-alert-tint px-3 py-2 text-xs text-ac-alert-text">
          {error}
        </div>
      )}
      {files.length === 0 && !loading ? (
        <p className="py-10 text-center text-[13px] text-ac-muted">No changes in this scope.</p>
      ) : (
        <div className="grid grid-cols-[260px_1fr] gap-3">
          <div className="self-start overflow-hidden rounded-[10px] border border-ac-line bg-ac-panel py-1" aria-label="Files" role="tree">
            {dirs.map((dir) => (
              <div key={dir} role="group">
                <div className="flex items-center gap-1.5 px-2.5 py-1 font-ac-mono text-[11px] text-ac-muted">
                  <ChevronDown className="size-3.5 text-ac-faint" />
                  {dir}/
                </div>
                {files
                  .filter((f) => dirOf(f.path) === dir)
                  .map((f) => (
                    <button
                      key={f.path}
                      type="button"
                      role="treeitem"
                      aria-current={f.path === shown ? "true" : undefined}
                      onClick={() => setCurrent(f.path)}
                      className={cn("relative mx-1 flex w-[calc(100%-8px)] items-center gap-2 rounded-md py-1 pl-6 pr-1.5 text-left", f.path === shown ? "bg-ac-raise" : "hover:bg-ac-raise")}
                    >
                      {f.path === shown && <Marker />}
                      <span className={cn("w-3 font-ac-mono text-[11px] font-semibold", STATUS_TONE[f.status])}>{f.status === "?" ? "A" : f.status}</span>
                      <span className="min-w-0 flex-1 truncate font-ac-mono text-[11.5px] text-ac-soft">{nameOf(f.path)}</span>
                      <span className="font-ac-mono text-[10.5px] text-ac-ok-text">+{f.added}</span>
                    </button>
                  ))}
              </div>
            ))}
          </div>
          <div className="space-y-3">
            {[...files].sort((a, b) => (a.path === shown ? -1 : b.path === shown ? 1 : 0)).map((f) => (
              <FileCard
                key={f.path}
                f={f}
                open={!collapsed.has(f.path)}
                onToggle={() => setCollapsed((c) => (c.has(f.path) ? new Set([...c].filter((x) => x !== f.path)) : new Set([...c, f.path])))}
                layout={layout}
                running={running}
                on={on}
              />
            ))}
            {undoable && (
              <div className="flex items-center gap-2 rounded-[10px] border border-ac-line bg-ac-panel px-3 py-2 text-[11px] text-ac-muted">
                <Undo2 className="size-3.5" /> The last discard can be undone
                <Button size="sm" variant="ghost" className="ml-auto" disabled={running} title={running ? LOCKED : undefined} onClick={on.undo}>
                  Undo
                </Button>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Act onClick={on.commit} disabled={running || staged === 0} title={running ? LOCKED : staged === 0 ? "Stage changes first" : undefined}>
                Commit {staged} staged…
              </Act>
              <Act onClick={on.createPr}>Create PR</Act>
              {on.agentReview && <Act onClick={on.agentReview}>Ask Codex to review</Act>}
              <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-ac-muted">
                <SquareTerminal className="size-3.5" /> Rewind stays in the terminal
              </span>
            </div>
          </div>
        </div>
      )}
    </PageBody>
  );
}
