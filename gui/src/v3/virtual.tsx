/** A windowed list for long timelines: only the rows near the viewport are in
 *  the DOM. Heights are measured once a row has rendered and estimated before.
 *  Sticks to the bottom while the user is at the bottom (a live turn grows). */

import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** One row: measured once when it mounts, then only when the browser reports a
 *  resize. Measuring on every render never settles when a height flips with the
 *  layout (scrollbar shows, text rewraps, scrollbar goes), and React then aborts
 *  the whole window. */
function MeasuredRow({ k, onHeight, children }: { k: string; onHeight: (key: string, h: number) => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    onHeight(k, el.getBoundingClientRect().height);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => onHeight(k, el.getBoundingClientRect().height));
    ro.observe(el);
    return () => ro.disconnect();
  }, [k, onHeight]);
  return (
    <div ref={ref} className="pb-3">
      {children}
    </div>
  );
}

export const OVERSCAN_PX = 600;

/** The rows to render for a scroll position. Pure.
 *  `heights[i]` is the measured height of row i, or undefined. */
export function visibleRange(count: number, heights: readonly (number | undefined)[], estimate: number, scrollTop: number, viewport: number, overscan = OVERSCAN_PX): { start: number; end: number; top: number; total: number } {
  let total = 0;
  let start = -1;
  let top = 0;
  let end = count;
  const lo = Math.max(0, scrollTop - overscan);
  const hi = scrollTop + viewport + overscan;
  for (let i = 0; i < count; i++) {
    const h = heights[i] ?? estimate;
    if (start < 0 && total + h > lo) {
      start = i;
      top = total;
    }
    if (start >= 0 && end === count && total > hi) end = i;
    total += h;
  }
  if (start < 0) start = count;
  return { start, end: Math.max(start, end), top, total };
}

export function VirtualList<T>({ items, keyOf, render, estimate = 64, className, label }: { items: readonly T[]; keyOf: (t: T) => string; render: (t: T) => ReactNode; estimate?: number; className?: string; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const heights = useRef(new Map<string, number>());
  const [scroll, setScroll] = useState({ top: 0, height: 800 });
  const [, bump] = useState(0);
  const atBottom = useRef(true);
  const measure = useCallback((key: string, h: number) => {
    if (h && heights.current.get(key) !== h) {
      heights.current.set(key, h);
      bump((x) => x + 1);
    }
  }, []);
  const hs = items.map((t) => heights.current.get(keyOf(t)));
  const r = visibleRange(items.length, hs, estimate, scroll.top, scroll.height);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  });
  return (
    <div
      ref={ref}
      role="log"
      aria-label={label}
      className={className}
      style={{ scrollbarGutter: "stable" }}
      onScroll={(e) => {
        const el = e.currentTarget;
        atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        setScroll({ top: el.scrollTop, height: el.clientHeight });
      }}
    >
      <div style={{ height: r.total, position: "relative" }}>
        <div style={{ position: "absolute", top: r.top, left: 0, right: 0 }}>
          {items.slice(r.start, r.end).map((t) => {
            const k = keyOf(t);
            return (
              <MeasuredRow key={k} k={k} onHeight={measure}>
                {render(t)}
              </MeasuredRow>
            );
          })}
        </div>
      </div>
    </div>
  );
}
