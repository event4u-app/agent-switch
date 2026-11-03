/**
 * The right tool windows (spec §9): Summary, Changes, Children. One open at a
 * time (frame.tsx); each says where its facts come from in the section's
 * tooltip. Adapted from the reference boards; data and actions come in as props.
 */

import type { ReactNode } from "react";
import { CircleX, ExternalLink, FolderGit2, GitBranch, Minus } from "lucide-react";
import { cn } from "../lib/utils.js";
import { IconButton } from "../ui/Button.js";
import { Act } from "./kit.js";
import { ChildLine, type ChildModel } from "./sessions.js";

function Window({ title, aside, onHide, children }: { title: string; aside?: ReactNode; onHide: () => void; children: ReactNode }) {
  return (
    <aside aria-label={title} className="flex w-[340px] shrink-0 flex-col overflow-hidden border-l border-ac-line bg-ac-panel">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-ac-line px-3">
        <span className="text-[12px] font-semibold text-ac-text">{title}</span>
        <span className="ml-auto flex items-center gap-1">
          {aside && <span className="text-[11px] text-ac-muted">{aside}</span>}
          <IconButton label="Hide  ⌘I" className="size-7" onClick={onHide}>
            <Minus />
          </IconButton>
        </span>
      </div>
      <div className="min-h-0 flex-1 relative overflow-y-auto">{children}</div>
    </aside>
  );
}

function Sect({ title, source, children }: { title: string; source?: string; children: ReactNode }) {
  return (
    <section className="px-3.5 py-2.5">
      <div className="mb-1 flex h-5 items-center">
        <span className="text-[11px] font-semibold text-ac-soft" title={source}>
          {title}
        </span>
      </div>
      {children}
    </section>
  );
}

// ---------- Summary (spec §9.1) ----------

export interface SummaryFacts {
  next: { text: string; action: string } | null;
  pr: { number: number; url: string; ci: string; lifecycle: string; mergeable: string; review: string; failingChecks: string[] } | null;
  git: { branch: string | null; worktree: boolean; changed: number; ahead: number | null; behind: number | null } | null;
  /** Only when the account is near its limit. */
  limit: ReactNode | null;
  more: { id: string; host: string; library: string; children: string };
}

const REVIEW: Record<string, string> = { REVIEW_REQUIRED: "review required", APPROVED: "approved", CHANGES_REQUESTED: "changes requested" };

/** "open · conflict · changes requested": lifecycle, mergeability, review — no review word when none is asked for. Pure. */
export function prLine(pr: { lifecycle: string; mergeable: string; review: string }): string {
  const merge = pr.mergeable === "CONFLICTING" ? "conflict" : pr.mergeable === "MERGEABLE" ? "mergeable" : pr.mergeable === "UNKNOWN" || !pr.mergeable ? "" : pr.mergeable.toLowerCase();
  return [pr.lifecycle.toLowerCase(), merge, REVIEW[pr.review] ?? ""].filter(Boolean).join(" · ");
}

export function SummaryWindow({ f, onNext, onCreatePr, onOpenPr, onHide, moreOpen, onToggleMore }: { f: SummaryFacts; onNext: () => void; onCreatePr: () => void; onOpenPr: () => void; onHide: () => void; moreOpen: boolean; onToggleMore: () => void }) {
  return (
    <Window title="Summary" onHide={onHide}>
      {f.next && (
        <div className="m-3 rounded-[10px] border border-ac-line bg-ac-bg p-3">
          <p className="text-[12.5px] leading-snug text-ac-text">{f.next.text}</p>
          <div className="mt-2">
            <Act kind="accent" onClick={onNext}>
              {f.next.action}
            </Act>
          </div>
        </div>
      )}
      <Sect title="Pull request" source="GitHub · refreshed every 60 s while the session runs">
        {f.pr ? (
          <>
            <div className="flex min-w-0 items-center gap-1.5 text-xs">
              {f.pr.ci === "FAILURE" && <CircleX className="size-3.5 shrink-0 text-ac-alert" />}
              <span className="text-ac-text">#{f.pr.number}</span>
              <span className={f.pr.ci === "FAILURE" ? "text-ac-alert-text" : "text-ac-soft"}>{f.pr.ci === "FAILURE" ? "CI failing" : `CI ${f.pr.ci.toLowerCase()}`}</span>
              <button type="button" aria-label="Open on GitHub" title="Open on GitHub" onClick={onOpenPr} className="ml-auto inline-flex shrink-0 text-ac-muted hover:text-ac-text">
                <ExternalLink className="size-3.5" />
              </button>
            </div>
            <div className="pl-5 text-xs text-ac-muted">{prLine(f.pr)}</div>
            {f.pr.failingChecks.map((c) => (
              <div key={c} className="mt-1 truncate pl-5 text-xs text-ac-alert-text">
                {c} failed
              </div>
            ))}
          </>
        ) : (
          <div className="flex items-center gap-2 text-xs text-ac-muted">
            No PR yet
            <Act kind="ghost" onClick={onCreatePr}>
              Create PR…
            </Act>
          </div>
        )}
      </Sect>
      {f.git && (
        <Sect title="Git" source="from the session's hooks">
          <div className="flex min-w-0 items-center gap-1.5 text-xs text-ac-soft">
            <GitBranch className="size-3.5 shrink-0 text-ac-muted" aria-hidden />
            <span className="truncate">{f.git.branch ?? "(detached)"}</span>
            {f.git.worktree && <FolderGit2 className="size-3.5 shrink-0 text-ac-muted" aria-label="worktree" />}
            <span className="ml-auto shrink-0 text-ac-muted">
              {f.git.changed ? <span className="text-ac-warn-text">{f.git.changed} changed</span> : "clean"}
              {f.git.ahead || f.git.behind ? ` · ↑${f.git.ahead ?? 0} ↓${f.git.behind ?? 0}` : ""}
            </span>
          </div>
        </Sect>
      )}
      {f.limit && <Sect title="Limit">{f.limit}</Sect>}
      <Sect title="More">
        <button type="button" aria-expanded={moreOpen} onClick={onToggleMore} className="text-xs text-ac-muted hover:text-ac-text">
          ID, host, library, children ›
        </button>
        {moreOpen && (
          <dl className="mt-1.5 space-y-0.5 text-xs">
            {(
              [
                ["ID", f.more.id],
                ["Host", f.more.host],
                ["Library", f.more.library],
                ["Children", f.more.children],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="grid grid-cols-[72px_1fr] gap-2">
                <dt className="text-ac-muted">{k}</dt>
                <dd className="truncate text-ac-soft">{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </Sect>
    </Window>
  );
}

// ---------- Changes (spec §9.2) ----------

export interface ChangedFile {
  status: "A" | "M" | "D" | "R" | "?";
  path: string;
  added: number;
  removed: number;
}

export function ChangesWindow({ files, onReview, onCommit, onHide, reviewAvailable, commitAvailable = true }: { files: ChangedFile[]; onReview: () => void; onCommit: () => void; onHide: () => void; reviewAvailable: boolean; commitAvailable?: boolean }) {
  const added = files.reduce((n, f) => n + f.added, 0);
  const removed = files.reduce((n, f) => n + f.removed, 0);
  return (
    <Window title="Changes" aside="worktree vs HEAD" onHide={onHide}>
      <div className="px-3.5 py-2.5 text-xs text-ac-soft">
        {files.length} files · <span className="text-ac-ok-text">+{added}</span> <span className="text-ac-alert-text">−{removed}</span>
      </div>
      {files.map((f) => {
        const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/") + 1) : "";
        return (
          <div key={f.path} className="flex h-6 items-center gap-2 px-3.5 font-ac-mono text-[11.5px]">
            <span className={cn("w-3 shrink-0", f.status === "A" ? "text-ac-ok-text" : f.status === "D" ? "text-ac-alert-text" : "text-ac-info-text")}>{f.status}</span>
            <span className="min-w-0 flex-1 truncate">
              <span className="text-ac-faint">{dir}</span>
              <span className="text-ac-soft">{f.path.slice(dir.length)}</span>
            </span>
            <span className="text-ac-ok-text">+{f.added}</span>
            <span className="text-ac-alert-text">−{f.removed}</span>
          </div>
        );
      })}
      <div className="flex gap-2 px-3.5 py-3">
        <Act kind="accent" onClick={onReview} disabled={!reviewAvailable} title={reviewAvailable ? undefined : "Review arrives with the next version"}>
          Review changes
        </Act>
        <Act onClick={onCommit} disabled={!commitAvailable} title={commitAvailable ? undefined : "Commit arrives with the next version"}>
          Commit…
        </Act>
      </div>
    </Window>
  );
}

/** `git diff --numstat` + `git status --porcelain` lines → rows. Pure. */
export function changedFiles(numstat: string, porcelain: string): ChangedFile[] {
  const counts = new Map<string, [number, number]>();
  for (const l of numstat.split("\n").filter(Boolean)) {
    const [a, r, p] = l.split("\t");
    counts.set(p, [Number(a) || 0, Number(r) || 0]);
  }
  return porcelain
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const code = l.slice(0, 2);
      const p = l.slice(3).split(" -> ").pop()!;
      const status: ChangedFile["status"] = code.includes("?") ? "?" : code.includes("A") ? "A" : code.includes("D") ? "D" : code.includes("R") ? "R" : "M";
      const [added, removed] = counts.get(p) ?? [0, 0];
      return { status, path: p, added, removed };
    });
}

// ---------- Children (spec §9.3) ----------

export function ChildrenWindow({ noun, children, onHide }: { noun: string; children: ChildModel[]; onHide: () => void }) {
  return (
    <Window title="Children" aside={noun} onHide={onHide}>
      <div className="px-3.5 py-2">
        {children.map((c) => (
          <ChildLine key={c.id} c={c} />
        ))}
      </div>
      <p className="px-3.5 pb-3 text-[11px] leading-relaxed text-ac-muted">
        Each child says where it came from: its hooks, the lineage it named, Agent Switch starting it, or a count of files. A relation Agent Switch cannot prove is shown as relation unknown — it is never guessed.
      </p>
    </Window>
  );
}
