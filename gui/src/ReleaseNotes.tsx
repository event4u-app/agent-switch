import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { releaseNoteBlocks, type ReleaseNoteBlock } from "./release-notes.js";
import type { ReleaseInfo } from "./updates.js";

/**
 * The ONE place a release body is rendered in this app.
 *
 * Every surface that announces an agent-config update (Ecosystem card, Profiles
 * first-run card, Tooling row) mounts this component instead of formatting notes
 * itself — the reason the App keeps a single detection state: two renderers is
 * how two surfaces start describing the same release differently.
 *
 * Structure is a native `<details>`/`<summary>`, so open/close, keyboard
 * operation and the disclosure semantics come from the platform rather than
 * from a dependency. Content comes from the pure normaliser
 * (`release-notes.ts`), never from raw markdown — a raw body would show the
 * release template's HTML comment and its `([sha](url))` suffixes.
 *
 * Honesty rule, shared with the Update buttons: a release whose body normalises
 * to nothing renders NOTHING. There is no placeholder, no "no notes available"
 * row, no spinner — the same reason an unknown latest version shows no button.
 */

/** Split `hooks: stop pointing at bare skills` into its scope prefix and the
 *  rest, so the prefix can be weighted for scanning. Only a short, few-word
 *  prefix qualifies — a sentence that merely contains a colon is left whole.
 *  Pure; exported for its unit test. */
export function splitItemLead(text: string): { lead: string | null; rest: string } {
  const colon = text.indexOf(":");
  if (colon <= 0) return { lead: null, rest: text };
  const lead = text.slice(0, colon);
  if (lead.length > 28 || lead.split(/\s+/).length > 3) return { lead: null, rest: text };
  return { lead, rest: text.slice(colon + 1).trim() };
}

/** `2026-08-18T16:47:49Z` → a locale date; null for missing or unparseable
 *  input, so the caller omits the date rather than printing "Invalid Date". */
export function formatPublishedAt(iso: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString();
}

/** Consecutive `item` blocks belong to one list; everything else stands alone.
 *  Grouping here (rather than emitting a `<ul>` per bullet) is what makes the
 *  rendered notes read as a list. Pure; exported for its unit test. */
export function groupBlocks(blocks: readonly ReleaseNoteBlock[]): (ReleaseNoteBlock | ReleaseNoteBlock[])[] {
  const out: (ReleaseNoteBlock | ReleaseNoteBlock[])[] = [];
  for (const b of blocks) {
    if (b.kind !== "item") {
      out.push(b);
      continue;
    }
    const tail = out[out.length - 1];
    if (Array.isArray(tail)) tail.push(b);
    else out.push([b]);
  }
  return out;
}

function Blocks({ blocks }: { blocks: readonly ReleaseNoteBlock[] }) {
  return (
    <>
      {groupBlocks(blocks).map((group, i) =>
        Array.isArray(group) ? (
          <ul key={i} className="mt-1 space-y-0.5">
            {group.map((item, j) => {
              const { lead, rest } = splitItemLead(item.text);
              return (
                <li key={j} className="flex gap-1.5 text-xs leading-snug text-muted-foreground">
                  <span aria-hidden className="select-none text-muted-foreground/60">
                    •
                  </span>
                  <span className="min-w-0">
                    {lead && <span className="font-medium text-foreground/80">{lead}: </span>}
                    {rest}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : group.kind === "heading" ? (
          <div
            key={i}
            className="mt-2.5 text-[10px] font-semibold uppercase tracking-[0.09em] text-foreground/70 first:mt-0"
          >
            {group.text}
          </div>
        ) : (
          <p key={i} className="mt-1 text-xs leading-snug text-muted-foreground">
            {group.text}
          </p>
        ),
      )}
    </>
  );
}

/**
 * One release, as a disclosure. Returns null when the body carries nothing
 * readable — the caller does not have to pre-check.
 */
export function ReleaseNotes({
  release,
  defaultOpen = false,
  onOpenUrl,
  className,
}: {
  release: ReleaseInfo;
  /** Open on mount. The Ecosystem card opens the newest one; compact surfaces
   *  stay closed so they keep their height until asked. */
  defaultOpen?: boolean;
  /** Opens the release page in the user's browser (Tauri shell in the app;
   *  injected so this component stays pure and testable). */
  onOpenUrl: (url: string) => void;
  className?: string;
}) {
  const blocks = releaseNoteBlocks(release.notes);
  if (blocks.length === 0) return null; // nothing readable → render nothing

  const date = formatPublishedAt(release.publishedAt);
  const title = release.name || release.tag;

  return (
    <details
      data-testid="release-notes"
      data-tag={release.tag}
      open={defaultOpen}
      className={cn("group rounded-md border border-border/70 bg-background/40", className)}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-1.5 text-[12px] font-medium marker:hidden hover:bg-accent/40 [&::-webkit-details-marker]:hidden">
        {/* Rotates with the disclosure so the open/closed state is visible. */}
        <span className="text-muted-foreground/70 transition-transform group-open:rotate-90" aria-hidden>
          ▸
        </span>
        <span className="min-w-0 truncate">What&apos;s new in {title}</span>
        {date && <span className="ml-auto shrink-0 tabular-nums text-[11px] text-muted-foreground">{date}</span>}
      </summary>
      <div className="border-t border-border/70 px-2.5 py-2">
        <div className="max-h-44 overflow-y-auto pr-1">
          <Blocks blocks={blocks} />
        </div>
        <button
          type="button"
          onClick={() => onOpenUrl(release.url)}
          className="mt-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground underline-offset-2 hover:underline"
        >
          <ExternalLink className="size-3" aria-hidden />
          Full release notes on GitHub
        </button>
      </div>
    </details>
  );
}

/**
 * Every unread release, newest first — so a user three versions behind reads
 * all three, not just the last one. The newest is expanded when `defaultOpen`
 * is set; the older ones stay collapsed. Returns null when no release in the
 * list has a readable body.
 */
export function ReleaseNotesStack({
  releases,
  defaultOpen = false,
  onOpenUrl,
  className,
}: {
  releases: readonly ReleaseInfo[];
  onOpenUrl: (url: string) => void;
  defaultOpen?: boolean;
  className?: string;
}) {
  const readable = releases.filter((r) => releaseNoteBlocks(r.notes).length > 0);
  if (readable.length === 0) return null;
  return (
    <div className={cn("space-y-1.5", className)} data-testid="release-notes-stack">
      {readable.map((r, i) => (
        <ReleaseNotes key={r.tag} release={r} defaultOpen={defaultOpen && i === 0} onOpenUrl={onOpenUrl} />
      ))}
    </div>
  );
}
