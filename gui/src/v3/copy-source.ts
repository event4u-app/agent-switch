/**
 * "Copy conversation" lives in the session's ⋯ menu (proposal C), but the rows
 * live in the view that reads them. The view registers how to copy its
 * session; the menu asks whether one is there and runs it.
 */
import { useEffect, useRef } from "react";

type Copy = () => Promise<void>;
const sources = new Map<string, { current: Copy }>();

/** While mounted, `copy` copies the conversation of `key`; null: nothing to copy yet. */
export function useCopySource(key: string | undefined, copy: Copy | null): void {
  const ref = useRef<Copy | null>(copy);
  ref.current = copy;
  const on = !!copy;
  useEffect(() => {
    if (!key || !on) return;
    const entry = { current: () => (ref.current ? ref.current() : Promise.resolve()) };
    sources.set(key, entry);
    return () => {
      if (sources.get(key) === entry) sources.delete(key);
    };
  }, [key, on]);
}

/** A view of `key` can copy its conversation now. */
export const canCopy = (key: string): boolean => sources.has(key);

/** Copies the conversation of `key` as Markdown; rejects when nothing is registered or the clipboard refuses. */
export function copyConversation(key: string): Promise<void> {
  const s = sources.get(key);
  return s ? s.current() : Promise.reject(new Error("nothing to copy"));
}
