import { Fragment, useEffect, type ReactNode } from "react";
import { syncLanguageFromStore, useLang } from "./index.js";

/** Re-mounts its subtree when the language changes, so every `t()` call —
 *  including memoised ones — renders in the new language. Keep it below the
 *  store provider: data and navigation survive the switch. Also follows a
 *  change made in another window (shared localStorage). */
export function LangKeyed({ children }: { children: ReactNode }) {
  const lang = useLang();
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === "agent-switch-language") syncLanguageFromStore();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return <Fragment key={lang}>{children}</Fragment>;
}
