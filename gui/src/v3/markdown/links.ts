/** Link policy for agent markdown (dialect: agents/evidence/markdown-corpus-2026-11.md).
 *  Agent output is untrusted: a destination becomes a link only when it is an
 *  absolute http(s) URL. Opening goes through the shell plugin, whose native
 *  scope (tauri.conf.json `plugins.shell.open`: any http(s) URL, owner
 *  decision 2026-11-05) checks it again; the webview itself never navigates. */

import { open as shellOpen } from "@tauri-apps/plugin-shell";

/** The normalised URL when `href` may become a link, else null. Pure. */
export function safeHref(href: string): string | null {
  // Control characters and whitespace are never part of a destination we accept,
  // even where URL parsing would quietly strip them.
  if (!href || /[\u0000- \u007f-\u009f]/.test(href)) return null;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!url.hostname) return null;
  return url.href;
}

export type LinkOutcome = "opened" | "copied" | "refused";

/** A plain click on a link: copy its address. */
export async function copyLink(href: string, deps: { copy?: (text: string) => Promise<void> } = {}): Promise<LinkOutcome> {
  const url = safeHref(href);
  if (!url) return "refused";
  const copy = deps.copy ?? ((t: string) => navigator.clipboard.writeText(t));
  try {
    await copy(url);
    return "copied";
  } catch {
    return "refused";
  }
}

/** ⌘/Ctrl-click: opens `href` when the native scope allows it; otherwise copies
 *  it, so the click still gives the user the address. Never calls window.open. */
export async function activateLink(
  href: string,
  deps: { open?: (url: string) => Promise<void>; copy?: (text: string) => Promise<void> } = {},
): Promise<LinkOutcome> {
  const url = safeHref(href);
  if (!url) return "refused";
  const open = deps.open ?? ((u: string) => shellOpen(u));
  const copy = deps.copy ?? ((t: string) => navigator.clipboard.writeText(t));
  try {
    await open(url);
    return "opened";
  } catch {
    try {
      await copy(url);
      return "copied";
    } catch {
      return "refused";
    }
  }
}
