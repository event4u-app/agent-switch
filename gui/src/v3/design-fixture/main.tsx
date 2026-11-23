/**
 * Design fixture: the real v3 window with the demo data of the reference
 * boards, so the app and the design can be compared screen by screen.
 * Open /design.html?theme=darcula&view=…&health=down|ready&away=1.
 * Not shipped: design.html is not in vite's build inputs.
 */
import { createRoot } from "react-dom/client";
import type { Accent } from "../themes/resolve.js";
import { Scene } from "./scene.js";

const q = new URLSearchParams(location.search);

createRoot(document.getElementById("root")!).render(
  <Scene view={q.get("view") ?? "main"} theme={q.get("theme") || "darcula"} accent={(q.get("accent") || "theme") as Accent} health={q.get("health") ?? undefined} away={!!q.get("away")} />,
);
