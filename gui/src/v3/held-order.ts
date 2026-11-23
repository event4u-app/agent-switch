/**
 * Order hold (D9): while the pointer is on a list or a row in it has keyboard
 * focus, rows keep their place; rows that left disappear and arrivals go where
 * the new order puts them.
 *
 * `mergeHeldOrder` is ported from stablyai/orca (https://github.com/stablyai/orca),
 * commit 923b19d, src/renderer/src/components/sidebar/worktree-list/listing/held-order.ts.
 * MIT License, Copyright (c) 2026 Lovecast Inc.
 */

import { useCallback, useRef, useState, type FocusEvent } from "react";

/** While engaged, retain existing positions, remove departed rows and insert arrivals by next order; reuse equal arrays. */
export function mergeHeldOrder(held: string[], next: readonly string[]): string[] {
  const nextIds = new Set(next);
  const heldIds = new Set(held);
  const kept = held.filter((id) => nextIds.has(id));
  if (kept.length === held.length && kept.length === next.length) {
    return held;
  }
  next.forEach((id, index) => {
    if (!heldIds.has(id)) {
      // Arrivals run in `next` order, so `next[index - 1]` is always in `kept` already: kept, or inserted one step earlier.
      kept.splice(index === 0 ? 0 : kept.indexOf(next[index - 1]) + 1, 0, id);
    }
  });
  return kept;
}

/** The key order to show: `keys` while not engaged, the held order merged with `keys` while engaged. */
export function useHeldOrder(keys: readonly string[], engaged: boolean): readonly string[] {
  const held = useRef<string[] | null>(null);
  if (!engaged) {
    held.current = null;
    return keys;
  }
  held.current = mergeHeldOrder(held.current ?? [...keys], keys);
  return held.current;
}

/** Pointer inside or keyboard focus inside an element; spread `bind` on it. */
export function useEngaged() {
  const [pointer, setPointer] = useState(false);
  const [focus, setFocus] = useState(false);
  const onFocus = useCallback((e: FocusEvent<HTMLElement>) => setFocus(keyboardFocus(e.target)), []);
  const onBlur = useCallback((e: FocusEvent<HTMLElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocus(false);
  }, []);
  return {
    engaged: pointer || focus,
    bind: {
      onMouseEnter: () => setPointer(true),
      onMouseLeave: () => setPointer(false),
      onFocus,
      onBlur,
    },
  };
}

// A click also focuses the row; only focus the user moves by keyboard holds once the pointer has left.
function keyboardFocus(el: Element): boolean {
  try {
    return el.matches(":focus-visible");
  } catch {
    return true;
  }
}
