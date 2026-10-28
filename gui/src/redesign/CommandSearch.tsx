import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { cn } from "../lib/utils.js";
import { Kbd } from "../ui/Typography.js";
import {
  buildSearchIndex,
  filterSearch,
  SEARCH_KIND_LABEL,
  type SearchCrumb,
  type SearchItem,
  type SearchKind,
} from "../vm/search.js";
import { useAS } from "../vm/store.js";

/** ⌘K palette in the top bar (bundle `oP`, app L193–288). `collapsed` = icon
 *  button that expands into an overlaying field (narrow windows). */
export function CommandSearch({ collapsed }: { collapsed: boolean }) {
  const s = useAS();
  const { accounts, sessions, rules, tools } = s;
  const index = useMemo(() => buildSearchIndex({ accounts, sessions, rules, tools }), [accounts, sessions, rules, tools]);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<SearchKind | "all">("all");
  const [trail, setTrail] = useState<SearchCrumb[]>([]);
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const result = filterSearch(index, trail, query, kind);
  const showList = open && (result.shown.length > 0 || trail.length > 0 || query.trim().length >= 2);
  const visible = !collapsed || expanded;

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setExpanded(true);
        requestAnimationFrame(() => input.current?.focus());
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function reset() {
    setQuery("");
    setTrail([]);
    setKind("all");
    setActive(-1);
    setOpen(false);
    setExpanded(false);
  }

  function choose(item: SearchItem | undefined) {
    if (!item) return;
    const t = item.target;
    reset();
    input.current?.blur();
    switch (t.type) {
      case "screen":
        s.go(t.screen);
        break;
      case "account":
        s.open({ kind: "account", id: t.id });
        break;
      case "session":
        s.open({ kind: "session", id: t.id });
        break;
      case "start":
        s.open({ kind: "start", cwd: t.cwd });
        break;
      case "tools":
        s.go("tools");
        s.setToolsTab("tools");
        break;
      case "projects":
        s.go("accounts");
        s.setAccountsTab("projects");
        break;
      case "add-account":
        s.open({ kind: "add-account" });
        break;
    }
  }

  function drillIn(i: number) {
    const item = result.shown[i];
    if (!item?.kids?.length) return;
    setTrail([...trail, { crumb: item.text, kids: item.kids, q: query, kind, index: i }]);
    setQuery("");
    setKind("all");
    setActive(0);
    setOpen(true);
  }

  function back() {
    const last = trail[trail.length - 1];
    if (!last) return;
    setTrail(trail.slice(0, -1));
    setQuery(last.q);
    setKind(last.kind);
    setActive(last.index);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const el = e.currentTarget;
    const n = result.shown.length;
    const atStart = el.selectionStart === 0 && el.selectionEnd === 0;
    const atEnd = el.selectionStart === el.value.length && el.selectionEnd === el.value.length;
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp": {
        e.preventDefault();
        if (!open) return setOpen(true);
        if (!n) return;
        const step = e.key === "ArrowDown" ? 1 : -1;
        setActive(active < 0 ? (step > 0 ? 0 : n - 1) : (active + step + n) % n);
        return;
      }
      case "PageDown":
      case "PageUp":
        if (!n) return;
        e.preventDefault();
        setActive(Math.max(0, Math.min(n - 1, active + (e.key === "PageDown" ? 5 : -5))));
        return;
      case "Home":
      case "End":
        if (!open || !n) return;
        e.preventDefault();
        setActive(e.key === "Home" ? 0 : n - 1);
        return;
      case "Enter":
        if (!n) return;
        e.preventDefault();
        choose(result.shown[Math.max(0, active)]);
        return;
      case "ArrowRight":
        if (!atEnd || active < 0 || !result.shown[active]?.kids) return;
        e.preventDefault();
        drillIn(active);
        return;
      case "ArrowLeft":
        if (!trail.length || !(atStart || !el.value)) return;
        e.preventDefault();
        back();
        return;
      case "Backspace":
        if (el.value || !trail.length) return;
        e.preventDefault();
        back();
        return;
      case "Escape":
        e.preventDefault();
        if (open) {
          setOpen(false);
          setActive(-1);
        } else reset();
        return;
    }
  }

  if (!visible) {
    return (
      <button
        type="button"
        onClick={() => {
          setExpanded(true);
          requestAnimationFrame(() => input.current?.focus());
        }}
        className="inline-flex h-8 items-center gap-2 rounded-md border border-ac-line px-2 text-ac-muted hover:border-ac-line2 hover:text-ac-text"
        aria-label={"Search (⌘K)"}
        title={"Search (⌘K)"}
      >
        <Search className="size-4" />
        <Kbd>{"⌘K"}</Kbd>
      </button>
    );
  }

  const activeId = active >= 0 && result.shown[active] ? `${listId}-${active}` : undefined;
  const crumb = trail[trail.length - 1]?.crumb;

  return (
    <div
      className={cn(
        "relative",
        collapsed ? "absolute right-3 top-1/2 z-30 w-[min(460px,calc(100vw-24px))] -translate-y-1/2" : "w-[240px] 2xl:w-[300px]",
      )}
    >
      <div
        className={cn(
          "flex h-8 items-center gap-2 rounded-md border bg-ac-bg px-2.5 transition-colors",
          open ? "border-ac-brand-line" : "border-ac-line hover:border-ac-line2",
        )}
      >
        <Search className="size-4 shrink-0 text-ac-muted" aria-hidden />
        <input
          ref={input}
          type="search"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={activeId}
          aria-label="Search sessions, accounts, projects"
          value={query}
          placeholder={"Session, account, project …"}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            setOpen(false);
            if (collapsed && !query) setExpanded(false);
          }}
          onKeyDown={onKeyDown}
          className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-ac-text outline-none placeholder:text-ac-faint [&::-webkit-search-cancel-button]:hidden"
        />
        {!query && <Kbd>{"⌘K"}</Kbd>}
      </div>
      {showList && (
        <div
          className="ac-dialog absolute right-0 top-[calc(100%+6px)] z-50 w-[max(100%,480px)] max-w-[calc(100vw-24px)] overflow-hidden rounded-lg border border-ac-line2 bg-ac-panel shadow-[var(--ac-shadow)]"
          onMouseDown={(e) => e.preventDefault()}
        >
          {crumb && (
            <div className="flex items-center gap-2 border-b border-ac-line px-2 py-1.5">
              <button
                type="button"
                onClick={back}
                className="inline-flex size-6 items-center justify-center rounded text-ac-muted hover:bg-ac-raise hover:text-ac-text"
                aria-label="Back"
              >
                <ChevronLeft className="size-4" />
              </button>
              <span className="truncate text-xs text-ac-soft">{crumb}</span>
            </div>
          )}
          {result.order.length > 1 && (
            <div className="flex flex-wrap gap-1 border-b border-ac-line px-2 py-2" role="group" aria-label="Filter by kind">
              {(["all", ...result.order] as const).map((k) => {
                const pressed = result.kind === k;
                return (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={pressed}
                    onClick={() => {
                      setKind(k);
                      setActive(0);
                    }}
                    className={cn(
                      "h-6 rounded-md px-2 text-[11px] font-medium",
                      pressed
                        ? "bg-ac-brand-tint text-ac-text shadow-[inset_0_0_0_1px_var(--ac-brand-line)]"
                        : "text-ac-soft shadow-[inset_0_0_0_1px_var(--ac-line)] hover:text-ac-text",
                    )}
                  >
                    {k === "all" ? `All ${result.all.length}` : `${SEARCH_KIND_LABEL[k]} ${result.counts[k]}`}
                  </button>
                );
              })}
            </div>
          )}
          <ul id={listId} role="listbox" className="max-h-[360px] overflow-y-auto p-1">
            {result.shown.map((item, i) => (
              <li
                key={item.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseMove={() => i !== active && setActive(i)}
                onClick={() => choose(item)}
                className={cn(
                  "flex min-h-10 cursor-default items-center gap-3 rounded-md px-2.5 py-1.5",
                  i === active && "bg-ac-brand-tint shadow-[inset_0_0_0_1px_var(--ac-brand-line)]",
                )}
              >
                <span className="w-16 shrink-0 text-[10px] font-medium uppercase tracking-[0.12em] text-ac-faint">
                  {SEARCH_KIND_LABEL[item.kind].replace(/s$/, "")}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[13px] text-ac-text">{item.text}</span>
                  <span className="truncate text-[11px] text-ac-muted">{item.meta}</span>
                </span>
                {item.kids && (
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label={`Show ${item.kids.length} inside`}
                    onClick={(e) => {
                      e.stopPropagation();
                      drillIn(i);
                    }}
                    className="inline-flex h-6 items-center gap-1 rounded px-1.5 font-ac-mono text-[11px] text-ac-muted hover:bg-ac-raise hover:text-ac-text"
                  >
                    {item.kids.length}
                    <ChevronRight className="size-3.5" />
                  </button>
                )}
              </li>
            ))}
            {!result.shown.length && (
              <li className="px-3 py-4 text-xs text-ac-muted">
                {"Nothing matches “"}
                {query.trim()}
                {"”."}
              </li>
            )}
          </ul>
          <div className="flex items-center justify-between gap-3 border-t border-ac-line px-3 py-1.5 text-[11px] text-ac-faint">
            <span>{result.all.length} hits</span>
            <span className="hidden sm:inline">{"↑↓ move · ↵ open · → into · ← back · esc"}</span>
          </div>
        </div>
      )}
    </div>
  );
}
