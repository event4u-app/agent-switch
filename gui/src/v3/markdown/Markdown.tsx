/** Agent markdown in the chat (roadmap road-to-a-chat-that-reads-well 2.4–2.6).
 *  Fixed components per tree node; nothing from the input becomes an element
 *  name or an attribute. While a message is live, parsing is coalesced to one
 *  per frame and unchanged blocks keep their identity, so React leaves them alone. */

import { Component, memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ChevronRight, Copy } from "lucide-react";

import { cn } from "../../lib/utils.js";
import { getChatMarkdown } from "../../settings-store.js";
import { DiffLines } from "../chat.js";
import { activateLink, copyLink, type LinkOutcome } from "./links.js";
import type { Block, Inline } from "./nodes.js";
import { parseMarkdown } from "./parse.js";

/** Above this many characters a message is shown as plain text (2.6). */
export const MAX_SOURCE = 200_000;
/** Above this many tree nodes a message is shown as plain text (2.6). */
export const MAX_NODES = 20_000;

let enabled: boolean | null = null;
/** The settings switch (2.6): off → every message renders as plain text. */
export function setMarkdownEnabled(on: boolean): void {
  enabled = on;
}
const isEnabled = () => (enabled ??= getChatMarkdown());

/** Parse, or null when the message must fall back to plain text. Pure. */
export function treeFor(source: string): Block[] | null {
  if (!isEnabled() || source.length > MAX_SOURCE) return null;
  try {
    const tree = parseMarkdown(source);
    return countNodes(tree) > MAX_NODES ? null : tree;
  } catch {
    return null;
  }
}

function countNodes(bs: readonly Block[]): number {
  let n = 0;
  const inl = (xs: readonly Inline[]) => {
    for (const x of xs) {
      n++;
      if ("c" in x) inl(x.c);
    }
  };
  for (const b of bs) {
    n++;
    if ("c" in b) inl(b.c);
    if (b.t === "quote" || b.t === "details") n += countNodes(b.blocks);
    if (b.t === "details" && b.summary) inl(b.summary);
    if (b.t === "list") for (const i of b.items) n += countNodes(i.blocks);
    if (b.t === "table") for (const r of [b.head, ...b.rows]) for (const c of r) inl(c);
    if (b.t === "diff") n += b.hunks.reduce((s, h) => s + h.lines.length, 0);
  }
  return n;
}

/** Keeps the previous object for every top-level block that did not change, so
 *  memoised block components skip it. Pure. */
export function reuseBlocks(prev: readonly Block[], next: Block[]): Block[] {
  return next.map((b, i) => {
    const p = prev[i];
    return p && p.t === b.t && JSON.stringify(p) === JSON.stringify(b) ? p : b;
  });
}

const frame: (cb: () => void) => () => void =
  typeof requestAnimationFrame === "function"
    ? (cb) => {
        const id = requestAnimationFrame(cb);
        return () => cancelAnimationFrame(id);
      }
    : (cb) => {
        const id = setTimeout(cb, 16);
        return () => clearTimeout(id);
      };

/** The latest `source`, but while `live` at most one update per frame. */
export function useCoalesced(source: string, live: boolean): string {
  const [shown, setShown] = useState(source);
  const latest = useRef(source);
  latest.current = source;
  useEffect(() => {
    if (!live) {
      setShown(source);
      return;
    }
    return frame(() => setShown(latest.current));
  }, [source, live]);
  return live ? shown : source;
}

class Fallback extends Component<{ text: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidUpdate(prev: { text: string }) {
    if (prev.text !== this.props.text && this.state.failed) this.setState({ failed: false });
  }
  render() {
    return this.state.failed ? <PlainText text={this.props.text} /> : this.props.children;
  }
}

function PlainText({ text }: { text: string }) {
  return <div className="whitespace-pre-wrap">{text}</div>;
}

/** Agent markdown. `live`: the message is still streaming — its last block may
 *  change, so links in it stay inert until it is settled. */
export function Markdown({ source, live = false, className }: { source: string; live?: boolean; className?: string }) {
  const text = useCoalesced(source, live);
  const prev = useRef<Block[]>([]);
  const tree = useMemo(() => {
    const t = treeFor(text);
    if (!t) return null;
    const kept = reuseBlocks(prev.current, t);
    prev.current = kept;
    return kept;
  }, [text]);
  return (
    <div className={cn("min-w-0 text-[13px] leading-relaxed text-ac-soft", className)} data-md="">
      <Fallback text={text}>
        {tree ? tree.map((b, i) => <BlockView key={i} b={b} inert={live && i === tree.length - 1} />) : <PlainText text={text} />}
      </Fallback>
    </div>
  );
}

const BlockView = memo(function BlockView({ b, inert }: { b: Block; inert: boolean }) {
  return <>{block(b, inert)}</>;
});

function blocks(bs: readonly Block[], inert: boolean): ReactNode {
  return bs.map((b, i) => <BlockView key={i} b={b} inert={inert} />);
}

const H = ["text-[17px]", "text-[15px]", "text-[14px]", "text-[13px]", "text-[13px]", "text-[13px]"];

function block(b: Block, inert: boolean): ReactNode {
  switch (b.t) {
    case "p":
      return <p className="my-2 whitespace-pre-wrap first:mt-0 last:mb-0">{inlines(b.c, inert)}</p>;
    case "span":
      return <span className="whitespace-pre-wrap">{inlines(b.c, inert)}</span>;
    case "h": {
      const Tag = (["h1", "h2", "h3", "h4", "h5", "h6"] as const)[Math.min(Math.max(b.level, 1), 6) - 1]!;
      return <Tag className={cn("mb-1.5 mt-4 font-semibold text-ac-text first:mt-0", H[b.level - 1])}>{inlines(b.c, inert)}</Tag>;
    }
    case "hr":
      return <hr className="my-3 border-ac-line" />;
    case "quote":
      return <blockquote className="my-2 border-l-2 border-ac-line2 pl-3 text-ac-muted">{blocks(b.blocks, inert)}</blockquote>;
    case "list": {
      const items = b.items.map((it, i) => (
        <li key={i} className={cn("pl-0.5", it.task !== null && "list-none -ml-4")}>
          {it.task !== null && <input type="checkbox" checked={it.task} disabled readOnly aria-label={it.task ? "done" : "open"} className="mr-1.5 align-[-1px] accent-[var(--ac-brand)]" />}
          {blocks(it.blocks, inert)}
        </li>
      ));
      return b.ordered ? (
        <ol start={b.start} className="my-2 list-decimal space-y-0.5 pl-5 first:mt-0 last:mb-0 [&_ol]:my-0.5 [&_ul]:my-0.5">
          {items}
        </ol>
      ) : (
        <ul className="my-2 list-disc space-y-0.5 pl-5 first:mt-0 last:mb-0 [&_ol]:my-0.5 [&_ul]:my-0.5">{items}</ul>
      );
    }
    case "table":
      return (
        <div className="my-2 max-w-full overflow-x-auto rounded-[10px] border border-ac-line">
          <table className="w-max min-w-full border-collapse text-[12.5px]">
            <thead className="bg-ac-panel">
              <tr>
                {b.head.map((c, i) => (
                  <th key={i} className="border-b border-ac-line px-2.5 py-1.5 font-semibold text-ac-text" style={{ textAlign: b.align[i] ?? "left" }}>
                    {inlines(c, inert)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, ri) => (
                <tr key={ri} className="border-t border-ac-line first:border-t-0">
                  {r.map((c, i) => (
                    <td key={i} className="px-2.5 py-1.5 align-top" style={{ textAlign: b.align[i] ?? "left" }}>
                      {inlines(c, inert)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "code":
      return (
        <CodeFrame lang={b.lang} text={b.text}>
          <pre className="overflow-x-auto px-3 py-2 font-ac-mono text-[11.5px] leading-[1.55] text-ac-text">
            <code>{b.text}</code>
          </pre>
        </CodeFrame>
      );
    case "diff":
      return (
        <CodeFrame lang={b.lang} text={b.text}>
          <div className="overflow-x-auto py-1">
            <DiffLines hunks={b.hunks} numbered={b.numbered} />
          </div>
        </CodeFrame>
      );
    case "details":
      return (
        <details className="group my-2 rounded-[10px] border border-ac-line bg-ac-panel">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-ac-text [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-3.5 shrink-0 text-ac-faint transition-transform group-open:rotate-90" />
            <span className="min-w-0">{b.summary ? inlines(b.summary, inert) : "Details"}</span>
            {b.unclosed && inert && <span className="ml-1 font-normal text-ac-faint">…</span>}
          </summary>
          <div className="border-t border-ac-line px-3 py-2">{blocks(b.blocks, inert)}</div>
        </details>
      );
    case "literal":
      return <div className="my-2 whitespace-pre-wrap first:mt-0 last:mb-0">{b.v}</div>;
  }
}

function CodeFrame({ lang, text, children }: { lang: string; text: string; children: ReactNode }) {
  return (
    <div className="my-2 overflow-hidden rounded-[10px] border border-ac-line bg-ac-panel first:mt-0 last:mb-0">
      <div className="flex h-7 items-center gap-2 border-b border-ac-line px-3 text-[11px] text-ac-faint">
        <span className="font-ac-mono">{lang || "text"}</span>
        <CopyCode text={text} />
      </div>
      {children}
    </div>
  );
}

function CopyCode({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const id = setTimeout(() => setDone(false), 1500);
    return () => clearTimeout(id);
  }, [done]);
  return (
    <button
      type="button"
      aria-label={done ? "Copied" : "Copy code"}
      title={done ? "Copied" : "Copy code"}
      onClick={() => void navigator.clipboard?.writeText(text).then(() => setDone(true), () => {})}
      className="ml-auto inline-flex size-5 items-center justify-center rounded text-ac-faint hover:bg-ac-raise hover:text-ac-text [&_svg]:size-3"
    >
      {done ? <Check /> : <Copy />}
    </button>
  );
}

function inlines(xs: readonly Inline[], inert: boolean): ReactNode {
  return xs.map((x, i) => inline(x, i, inert));
}

function inline(x: Inline, key: number, inert: boolean): ReactNode {
  switch (x.t) {
    case "text":
      return x.v;
    case "code":
      return (
        <code key={key} className="rounded bg-ac-raise px-1 py-px font-ac-mono text-[0.9em] text-ac-text">
          {x.v}
        </code>
      );
    case "strong":
      return (
        <strong key={key} className="font-semibold text-ac-text">
          {inlines(x.c, inert)}
        </strong>
      );
    case "em":
      return <em key={key}>{inlines(x.c, inert)}</em>;
    case "del":
      return (
        <del key={key} className="text-ac-muted">
          {inlines(x.c, inert)}
        </del>
      );
    case "br":
      return <br key={key} />;
    case "link":
      return inert ? (
        <span key={key} className="text-ac-brand-text">
          {inlines(x.c, inert)}
        </span>
      ) : (
        <LinkView key={key} href={x.href}>
          {inlines(x.c, inert)}
        </LinkView>
      );
  }
}

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
/** The modifier that opens a link: ⌘ on macOS, Ctrl elsewhere. */
export const OPEN_KEY = IS_MAC ? "⌘" : "Ctrl";

const NOTE: Record<LinkOutcome, string> = {
  copied: "Link copied",
  opened: "Opened in the browser",
  refused: "Not a link that can be copied or opened",
};

/** A link in agent output (owner, 2026-11-05): a click copies the address,
 *  ⌘/Ctrl-click opens it in the browser. The tooltip shows the real address and
 *  says so; a short note confirms what happened. */
export function LinkView({ href, children }: { href: string; children: ReactNode }) {
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    if (!note) return;
    const id = setTimeout(() => setNote(null), 1800);
    return () => clearTimeout(id);
  }, [note]);
  return (
    <>
      <a
        href={href}
        title={`${href}\nClick: copy link · ${OPEN_KEY}-click: open in browser`}
        className="text-ac-brand-text underline decoration-ac-brand-line underline-offset-2 hover:decoration-current"
        onClick={(e) => {
          e.preventDefault();
          const open = e.metaKey || e.ctrlKey;
          void (open ? activateLink(href) : copyLink(href)).then((r) => setNote(open && r === "copied" ? "This address can only be copied — link copied" : NOTE[r]));
        }}
        onAuxClick={(e) => e.preventDefault()}
      >
        {children}
      </a>
      {note && (
        <span role="status" className="ml-1.5 rounded bg-ac-raise px-1.5 py-px text-[11px] text-ac-muted">
          {note}
        </span>
      )}
    </>
  );
}
