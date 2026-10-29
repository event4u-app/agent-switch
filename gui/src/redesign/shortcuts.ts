/** An app shortcut chord: ⌘ on macOS, Ctrl elsewhere (Ctrl on a Mac belongs
 *  to the terminal and text fields), no Alt/Shift — and never a key typed into
 *  the embedded terminal, where Ctrl+N/K/, are the program's. */
export function isAppShortcut(e: KeyboardEvent, isMac: boolean): boolean {
  if (e.altKey || e.shiftKey) return false;
  if (isMac ? !e.metaKey || e.ctrlKey : !e.ctrlKey || e.metaKey) return false;
  const t = e.target;
  return !(t instanceof Element && t.closest("[data-terminal]"));
}
