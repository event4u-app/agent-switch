import { describe, expect, it, vi } from "vitest";
import type { ReleaseInfo } from "../../updates.js";
import type { ActivityEvent, Check, Notice, Surface, ToolEntry } from "../../vm/types.js";
import { filterActivity } from "./activity.js";
import { foundLine, surfaceSub } from "./apps.js";
import { commandInFix, repairFor } from "./fix-dialog.js";
import { autostartRetry, autostartText, checksToLook, orderChecks } from "./health.js";
import { splitNotices } from "./notifications-sheet.js";
import { acReleaseFrom, agentConfigMissing, copyCommand, isolatedLabel, sortTools } from "./tools.js";
import { updateRun } from "./update-sheet.js";

// update-sheet pulls in xterm, which needs a canvas jsdom lacks.
vi.mock("@xterm/xterm", () => ({ Terminal: class {} }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class {} }));

const NOW = 1_800_000_000_000;

function tool(id: string, over: Partial<ToolEntry> = {}): ToolEntry {
  return { id, name: id, role: `${id} role`, present: true, version: "1.0.0", latest: "1.0.0", healthy: true, command: `agent-switch tooling upgrade ${id}`, ...over };
}

describe("tools logic", () => {
  it("sorts attention → update → ok → unknown → missing", () => {
    const rows = sortTools([
      tool("missing", { present: false }),
      tool("ok"),
      tool("unknown", { latest: null }),
      tool("update", { latest: "2.0.0" }),
      tool("attention", { healthy: false }),
    ]);
    expect(rows.map((t) => t.id)).toEqual(["attention", "update", "ok", "unknown", "missing"]);
  });

  it("copies the verified tooling command, else the hint's command, else nothing", () => {
    expect(copyCommand(tool("rtk"))).toBe("agent-switch tooling upgrade rtk");
    expect(copyCommand(tool("agy", { hint: "Install it from Google: `npm i -g x` then `agy --version`" }))).toBe("agy --version");
    expect(copyCommand(tool("agy", { hint: "No verified install command." }))).toBeNull();
  });

  it("counts isolated accounts per CLI, agy → antigravity", () => {
    const accts = [{ tool: "claude" }, { tool: "claude" }, { tool: "antigravity" }] as never[];
    expect(isolatedLabel("claude", accts)).toBe("2 accounts isolated");
    expect(isolatedLabel("agy", accts)).toBe("1 account isolated");
    expect(isolatedLabel("rtk", accts)).toBeNull();
  });

  it("treats agent-config as missing when not installed, or unknown with no binary", () => {
    const ac = (status: "live" | "unknown" | "not-installed") => ({ status, port: null, pid: null, version: null, latest: null, checkedAt: null });
    expect(agentConfigMissing({ agentConfig: ac("not-installed"), tools: [] })).toBe(true);
    expect(agentConfigMissing({ agentConfig: ac("unknown"), tools: [tool("agent-config", { present: false })] })).toBe(true);
    expect(agentConfigMissing({ agentConfig: ac("unknown"), tools: [tool("agent-config")] })).toBe(false);
    expect(agentConfigMissing({ agentConfig: ac("live"), tools: [] })).toBe(false);
  });

  it("derives agent-config's latest and the unread notes from its releases", () => {
    const rel = (tag: string, notes: string): ReleaseInfo => ({ tag, name: tag, url: `https://x/${tag}`, notes, publishedAt: "" });
    const releases = [rel("v18.2.0", "## Changes\n- Audit: partial\n- Threat rows"), rel("v18.1.0", "- old"), rel("v18.0.0", "- older")];
    const out = acReleaseFrom(releases, "18.0.0");
    expect(out?.latest).toBe("18.2.0");
    expect(out?.notes.map((n) => n.version)).toEqual(["18.2.0", "18.1.0"]);
    expect(out?.notes[0].items).toEqual(["Audit: partial", "Threat rows"]);
    expect(acReleaseFrom(releases, "18.2.0")).toEqual({ latest: "18.2.0", notes: [] });
    expect(acReleaseFrom([], "1.0.0")).toBeNull();
  });

  it("builds the install/update run for the terminal", () => {
    expect(updateRun("rtk", "update", "rtk")).toEqual({ args: ["tooling", "upgrade", "rtk"], title: "rtk", kicker: "Update" });
    expect(updateRun("agent-config", "install")).toEqual({ args: ["tooling", "install", "agent-config"], title: "agent-config", kicker: "Install" });
  });
});

describe("apps logic", () => {
  const surface = (over: Partial<Surface>): Surface => ({
    id: "claude-desktop",
    tool: "claude",
    name: "Claude Desktop",
    kind: "desktop",
    detected: true,
    capability: null,
    protection: null,
    identitySeen: null,
    launcher: null,
    checkedAt: null,
    ...over,
  });
  it("lists what was found", () => {
    expect(foundLine([surface({}), surface({ id: "b", name: "Codex", detected: false })])).toBe("Found 1 of 2: Claude Desktop.");
  });
  it("shows the age only when one was read", () => {
    expect(surfaceSub(surface({}), NOW)).toBe("DESKTOP");
    expect(surfaceSub(surface({ identitySeen: "a@b.test", checkedAt: NOW - 60_000 }), NOW)).toBe("Running as a@b.test · checked 1 min ago");
  });
});

describe("health logic", () => {
  it("states start at login from preference and OS state", () => {
    expect(autostartText("disabled", "disabled")).toBe("Off — you switched it off. Updates keep it off.");
    expect(autostartText("enabled", "enabled")).toBe("On — registered with the system and checked.");
    expect(autostartText("enabled", null)).toBe("Couldn't read the system state.");
    expect(autostartText("enabled", "disabled", "login item rejected")).toBe("Couldn't turn it on (login item rejected).");
    expect(autostartText("unset", "disabled")).toBe("Off — not registered with the system yet.");
    expect(autostartRetry("enabled", "disabled")).toBe(true);
    expect(autostartRetry("disabled", "disabled")).toBe(false);
    expect(autostartRetry("enabled", "enabled")).toBe(false);
  });

  it("counts only warn/fail as to check and orders problems first", () => {
    const c = (id: string, state: Check["state"]): Check => ({ id, title: id, detail: "", state });
    const checks = [c("a", "ok"), c("b", "info"), c("c", "warn"), c("d", "fail")];
    expect(checksToLook(checks).map((x) => x.id)).toEqual(["c", "d"]);
    expect(orderChecks(checks).map((x) => x.id)).toEqual(["d", "c", "b", "a"]);
  });

  it("repairs only where a backend call exists", () => {
    const act = { setAutostart: async () => {}, shareSync: async () => {} };
    expect(repairFor({ id: "autostart" }, act)).toBe("autostart");
    expect(repairFor({ id: "share-work" }, act)).toBe("share-sync");
    expect(repairFor({ id: "shell-integration" }, act)).toBeNull();
    expect(repairFor({ id: "autostart" }, {})).toBeNull();
  });

  it("finds the command a fix names", () => {
    expect(commandInFix('Add `eval "$(agent-switch shellenv)"` to your shell profile (see `agent-switch shellenv --help`).')).toBe('eval "$(agent-switch shellenv)"');
    expect(commandInFix("npm install -g @event4u/agent-switch")).toBe("npm install -g @event4u/agent-switch");
    expect(commandInFix("Sign one of them into a different account.")).toBeNull();
    expect(commandInFix(undefined)).toBeNull();
  });
});

describe("activity + notifications logic", () => {
  it("filters activity by group", () => {
    const e = (kind: ActivityEvent["kind"]): ActivityEvent => ({ id: kind, at: NOW, kind, text: kind });
    const all = [e("switch"), e("rebind"), e("update"), e("guard"), e("login")];
    expect(filterActivity(all, "all")).toHaveLength(5);
    expect(filterActivity(all, "sessions").map((x) => x.kind)).toEqual(["rebind"]);
    expect(filterActivity(all, "accounts").map((x) => x.kind)).toEqual(["switch", "login"]);
    expect(filterActivity(all, "system").map((x) => x.kind)).toEqual(["update", "guard"]);
  });

  it("splits notices into today (3 h) and earlier", () => {
    const n = (id: string, at: number): Notice => ({ id, title: id, detail: "", at, unread: false, tone: "info" });
    const { today, earlier } = splitNotices([n("a", NOW - 60_000), n("b", NOW - 4 * 3_600_000)], NOW);
    expect(today.map((x) => x.id)).toEqual(["a"]);
    expect(earlier.map((x) => x.id)).toEqual(["b"]);
  });
});
