/** The chat composer (spec §10.8), adapted from the reference board `v31.tsx`:
 *  attachment chips, the queue placeholder while a turn runs, Attach, Mode,
 *  "Stop ⌘." and "Queue ↵". `@` completes repository files, `/` the agent's
 *  slash commands; pasted or dropped files become attachments. */

import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import { ChevronDown, FileCode, Image, Paperclip, Send, Square, X } from "lucide-react";

import { cn } from "../lib/utils.js";
import { Button } from "../ui/Button.js";
import { Act } from "./kit.js";
import type { Attachment } from "./adapter/useBridge.js";

export type Mode = "default" | "acceptEdits" | "plan";
export const MODE_LABEL: Record<Mode, string> = { default: "Ask before edits", acceptEdits: "Edit without asking", plan: "Plan only" };

export interface Chip {
  id: string;
  label: string;
  kind: "image" | "file";
  size: number | null;
  attachment: Attachment;
}

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** A File (pasted, dropped or picked) → a chip. The bridge decides what it is from its bytes. */
export async function chipOf(f: File): Promise<Chip> {
  // FileReader, not File.arrayBuffer(): older webviews lack the latter.
  const buf = new Uint8Array(
    await new Promise<ArrayBuffer>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result as ArrayBuffer);
      r.onerror = () => rej(r.error);
      r.readAsArrayBuffer(f);
    }),
  );
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  const data = btoa(bin);
  const image = f.type.startsWith("image/");
  return { id: `${f.name}-${f.size}-${f.lastModified}`, label: f.name || "pasted image", kind: image ? "image" : "file", size: f.size, attachment: image ? { image: { mediaType: f.type, data } } : { file: { name: f.name, data } } };
}

/** The `@word` or `/word` being typed at the caret, if any. Pure. */
export function tokenAt(text: string, caret: number): { kind: "@" | "/"; query: string; start: number } | null {
  const before = text.slice(0, caret);
  const at = /(?:^|\s)@([^\s@]*)$/.exec(before);
  if (at) return { kind: "@", query: at[1], start: caret - at[1].length - 1 };
  const slash = /^\/([^\s/]*)$/.exec(before);
  if (slash) return { kind: "/", query: slash[1], start: 0 };
  return null;
}

export function Composer({
  running,
  queued,
  mode,
  onMode,
  onSend,
  onSteer,
  onStop,
  commands = [],
  findFiles,
  disabled,
}: {
  running: boolean;
  queued: number;
  mode: Mode;
  onMode: (m: Mode) => void;
  onSend: (text: string, attachments: Attachment[]) => void;
  /** ⌥↵ while a turn runs: add to it now (Codex steering) instead of queueing. */
  onSteer?: (text: string) => void;
  onStop: () => void;
  commands?: string[];
  findFiles?: (query: string) => Promise<string[]>;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");
  const [chips, setChips] = useState<Chip[]>([]);
  const [caret, setCaret] = useState(0);
  const [suggest, setSuggest] = useState<string[]>([]);
  const [modeOpen, setModeOpen] = useState(false);
  const [drag, setDrag] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const tok = tokenAt(text, caret);

  useEffect(() => {
    let alive = true;
    if (!tok) return void setSuggest([]);
    if (tok.kind === "/") setSuggest(commands.filter((c) => c.toLowerCase().startsWith(tok.query.toLowerCase())).slice(0, 8));
    else if (findFiles) void findFiles(tok.query).then((f) => alive && setSuggest(f.slice(0, 8))).catch(() => alive && setSuggest([]));
    return () => {
      alive = false;
    };
    // tok is derived from text and caret.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, caret, commands, findFiles]);

  const add = async (files: Iterable<File>) => {
    const next = await Promise.all([...files].map(chipOf));
    setChips((c) => [...c, ...next.filter((n) => !c.some((x) => x.id === n.id))]);
  };
  const pick = (s: string) => {
    if (!tok) return;
    if (tok.kind === "@") {
      setChips((c) => [...c, { id: `@${s}`, label: `@${s}`, kind: "file", size: null, attachment: { path: s } }]);
      setText(text.slice(0, tok.start) + text.slice(caret));
    } else setText(`/${s} `);
    setSuggest([]);
    area.current?.focus();
  };
  const submit = () => {
    const t = text.trim();
    if ((!t && !chips.length) || disabled) return;
    onSend(t, chips.map((c) => c.attachment));
    setText("");
    setChips([]);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggest.length && (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey))) {
      e.preventDefault();
      return pick(suggest[0]);
    }
    if (e.key === "Enter" && e.altKey && running && onSteer && text.trim()) {
      e.preventDefault();
      onSteer(text.trim());
      setText("");
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    } else if (e.key === "." && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onStop();
    }
  };
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...e.clipboardData.files];
    if (files.length) {
      e.preventDefault();
      void add(files);
    }
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDrag(false);
    if (e.dataTransfer.files.length) void add(e.dataTransfer.files);
  };

  return (
    <div className="shrink-0 border-t border-ac-line bg-ac-panel px-4 pb-3 pt-2.5">
      {chips.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <span key={c.id} className={cn("inline-flex h-6 items-center gap-1.5 rounded-md border border-ac-line2 bg-ac-raise px-2 text-[11.5px] text-ac-soft", c.label.startsWith("@") && "font-ac-mono")}>
              {c.kind === "image" ? <Image className="size-3.5" /> : <FileCode className="size-3.5" />} {c.label}
              {c.size !== null && <span className="text-ac-faint">{kb(c.size)}</span>}
              <button type="button" aria-label={`Remove ${c.label}`} onClick={() => setChips((x) => x.filter((y) => y.id !== c.id))} className="text-ac-faint hover:text-ac-text">
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div
        className={cn("relative rounded-[10px] border bg-ac-bg focus-within:border-ac-brand-line", drag ? "border-ac-brand-line" : "border-ac-line2")}
        onDragOver={(e) => (e.preventDefault(), setDrag(true))}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
      >
        {suggest.length > 0 && (
          <div role="listbox" aria-label={tok?.kind === "/" ? "Commands" : "Files"} className="absolute bottom-full left-2 mb-1 w-[360px] rounded-xl border border-ac-line2 bg-ac-panel p-1" style={{ boxShadow: "var(--ac-shadow)" }}>
            {suggest.map((s, i) => (
              <button key={s} type="button" role="option" aria-selected={i === 0} onMouseDown={(e) => (e.preventDefault(), pick(s))} className={cn("flex h-7 w-full items-center rounded-md px-2 text-left font-ac-mono text-[12px] text-ac-soft", i === 0 ? "bg-ac-raise text-ac-text" : "hover:bg-ac-raise")}>
                {tok?.kind === "/" ? `/${s}` : s}
              </button>
            ))}
          </div>
        )}
        <textarea
          ref={area}
          aria-label="Message"
          data-composer
          value={text}
          disabled={disabled}
          rows={2}
          onChange={(e) => (setText(e.target.value), setCaret(e.target.selectionStart))}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={onKey}
          onPaste={onPaste}
          placeholder={running ? "Queue a message — sent when this turn ends · @ files · / commands · drop images" : "Message — @ files · / commands · drop images"}
          className="block min-h-[54px] w-full resize-none bg-transparent px-3 py-2 text-[13px] text-ac-text outline-none placeholder:text-ac-faint"
        />
        <div className="flex items-center gap-2 px-2 pb-2">
          <input ref={picker} type="file" multiple hidden onChange={(e) => (e.target.files && void add(e.target.files), (e.target.value = ""))} />
          <Button size="sm" variant="ghost" onClick={() => picker.current?.click()}>
            <Paperclip /> Attach
          </Button>
          <span className="relative">
            <button type="button" aria-haspopup="menu" aria-expanded={modeOpen} onClick={() => setModeOpen((v) => !v)} className="inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-md px-2 text-xs text-ac-soft hover:bg-ac-raise">
              <span className="text-ac-muted">Mode</span> {MODE_LABEL[mode]} <ChevronDown className="size-3 text-ac-faint" />
            </button>
            {modeOpen && (
              <div role="menu" className="absolute bottom-full left-0 mb-1 w-[200px] rounded-xl border border-ac-line2 bg-ac-panel p-1" style={{ boxShadow: "var(--ac-shadow)" }}>
                {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
                  <button key={m} type="button" role="menuitemradio" aria-checked={m === mode} onClick={() => (setModeOpen(false), onMode(m))} className="flex h-8 w-full items-center rounded-md px-2.5 text-left text-[13px] text-ac-soft hover:bg-ac-raise">
                    {MODE_LABEL[m]}
                  </button>
                ))}
              </div>
            )}
          </span>
          {queued > 0 && <span className="text-[11px] text-ac-muted">{queued} queued</span>}
          <span className="ml-auto flex items-center gap-1.5">
            <Act onClick={onStop} disabled={!running}>
              <Square /> Stop <span className="font-ac-mono text-[10px] opacity-70">⌘.</span>
            </Act>
            <Act kind="accent" kbd="↵" onClick={submit} disabled={disabled || (!text.trim() && !chips.length)}>
              <Send /> Queue
            </Act>
          </span>
        </div>
      </div>
    </div>
  );
}
