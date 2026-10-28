/** The redesign stays behind a flag until every screen has landed:
 *  `localStorage["agent-switch-redesign"] = "1"` or `?redesign` in the URL. */
export const REDESIGN_FLAG_KEY = "agent-switch-redesign";

export function isRedesignEnabled(search: string = typeof location === "undefined" ? "" : location.search): boolean {
  if (new URLSearchParams(search).has("redesign")) return true;
  try {
    return localStorage.getItem(REDESIGN_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}
