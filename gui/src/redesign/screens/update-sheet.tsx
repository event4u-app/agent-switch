import { useAS, type TerminalRun } from "../../vm/store.js";
import { TerminalSheet } from "./terminal-sheet.js";

/** The run of an install/update (design `wP`): kicker Install/Update, the
 *  tool's name as title, `tooling install|upgrade <id>` in the real pty. */
export function updateRun(toolId: string, action: "install" | "update", toolName?: string): TerminalRun {
  const install = action === "install";
  return { args: ["tooling", install ? "install" : "upgrade", toolId], title: toolName ?? toolId, kicker: install ? "Install" : "Update" };
}

/** Bundle `wP` (sheet 520): lane A's terminal sheet streams the actual command
 *  instead of the design's scripted lines; closing re-reads the view model, so
 *  the new version and the cleared update badge come from the CLI. */
export function UpdateSheet({ toolId, action }: { toolId: string; action: "install" | "update" }) {
  const s = useAS();
  const tool = s.tools.find((t) => t.id === toolId);
  return <TerminalSheet run={updateRun(toolId, action, tool?.name)} />;
}
