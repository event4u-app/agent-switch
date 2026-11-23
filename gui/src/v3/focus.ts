/**
 * Focus for the v3 overlays (roadmap 7.5). A dialog takes focus from whatever
 * had it — often the hosted terminal, whose xterm swallows Esc — keeps Tab
 * inside itself, makes the window behind it inert and gives focus back on
 * close. A floating layer (menu, popover) takes focus on open and gives it back.
 */

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The elements Tab reaches inside `root`, in document order. */
export const focusables = (root: Element): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest("[inert]"));

const held = (): HTMLElement | null => (typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null);

/** Give focus back to `opener` unless something else took it on purpose. */
function restore(opener: HTMLElement | null, root: Element | null) {
  const now = document.activeElement;
  const lost = !now || now === document.body || !now.isConnected || (root?.contains(now) ?? false);
  if (opener?.isConnected && lost) opener.focus();
}

/** Open dialogs, innermost last: only the top one answers Esc and Tab. */
const stack: object[] = [];

/**
 * A modal dialog's focus: in on open (a `[data-autofocus]` control, else the
 * first control of `[data-dialog-body]`, else the first control), Tab trapped,
 * Esc closes in the capture phase so a focused terminal never sees it, the
 * siblings of `scrim` inert while open, focus back to the opener on close.
 */
export function useModalFocus(scrim: RefObject<HTMLElement | null>, dialog: RefObject<HTMLElement | null>, onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const box = dialog.current;
    const layer = scrim.current;
    if (!box || !layer) return;
    const me = {};
    stack.push(me);
    const opener = held();
    if (!box.contains(document.activeElement)) {
      const body = box.querySelector("[data-dialog-body]");
      const first = box.querySelector<HTMLElement>("[data-autofocus]") ?? (body && focusables(body)[0]) ?? focusables(box)[0] ?? box;
      first.focus();
    }
    const behind = layer.parentElement ? [...layer.parentElement.children].filter((c) => c !== layer && !c.hasAttribute("inert")) : [];
    behind.forEach((c) => c.setAttribute("inert", ""));
    const key = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== me) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close.current();
        return;
      }
      if (e.key !== "Tab" || e.metaKey || e.ctrlKey || e.altKey) return;
      const stops = focusables(box);
      if (!stops.length) return void e.preventDefault();
      const at = stops.indexOf(document.activeElement as HTMLElement);
      const wrapTo = e.shiftKey ? (at <= 0 ? stops.length - 1 : -1) : at < 0 || at === stops.length - 1 ? 0 : -1;
      if (wrapTo < 0) return;
      e.preventDefault();
      stops[wrapTo].focus();
    };
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("keydown", key, true);
      behind.forEach((c) => c.removeAttribute("inert"));
      stack.splice(stack.indexOf(me), 1);
      restore(opener, box);
    };
  }, [scrim, dialog]);
}

/** A floating layer's focus: its first enabled menu item (else its first control) on open, back to the opener on close. */
export function useLayerFocus(layer: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const box = layer.current;
    if (!box) return;
    const opener = held();
    if (!box.contains(document.activeElement)) {
      const first = box.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"]), [role="menuitemradio"]') ?? focusables(box)[0];
      first?.focus();
    }
    return () => restore(opener, box);
  }, [layer]);
}
