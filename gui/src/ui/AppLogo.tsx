import darkIcon from "../../src-tauri/icons/source/agent-switch-icon-dark.svg";
import lightIcon from "../../src-tauri/icons/source/agent-switch-icon-light.svg";
import { cn } from "../lib/utils.js";

/** Dark/light mark pair; CSS (`.as-icon-*` in index.css) shows the one matching the theme. Bundle `i0`. */
export function AppLogo({ className }: { className?: string }) {
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <img src={darkIcon} alt="" className="as-icon-dark size-full" draggable={false} />
      <img src={lightIcon} alt="" className="as-icon-light size-full" draggable={false} />
    </span>
  );
}
