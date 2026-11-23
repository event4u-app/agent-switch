/** The design boards draw the real window from fixture data; that data follows the
 *  app's own rules, so a board never shows a menu or a sheet the app would not (arena r3 08 F4). */
import { describe, expect, it } from "vitest";
import { makeData } from "./scene.js";

const data = makeData({ theme: "darcula", accent: "theme" });

describe("the design fixture's session menu", () => {
  it("a hosted session offers no Take over and no Detach; End and Compact are there", () => {
    const items = data.menu?.("claude/personal/s-themes") ?? [];
    expect(items).not.toContain("Take over here…");
    expect(items).not.toContain("Detach");
    expect(items).toContain("End…");
    expect(items).toContain("Compact");
  });

  it("a session in your own terminal offers Take over, and neither End nor Compact", () => {
    const items = data.menu?.("codex/work/s-hook") ?? [];
    expect(items).toContain("Take over here…");
    expect(items).not.toContain("End…");
    expect(items).not.toContain("Compact");
    expect(items).not.toContain("Detach");
  });
});

describe("the design fixture's decision sheet is the subject's", () => {
  it("one session: only that session moves, from its own account", () => {
    const d = data.decision("claude/work/s-council")!;
    expect(d.account).toBe("work");
    expect(d.sessions.map((s) => s.title)).toEqual(["Release plan agent-config 1.9"]);
    expect(d.nearLimit).toBe(false);
    expect(d.targets?.map((t) => t.name)).not.toContain("work");
  });

  it("an account near its limit says so, with its live sessions", () => {
    const d = data.decision("claude/side")!;
    expect(d.account).toBe("side");
    expect(d.nearLimit).toBe(true);
    expect(d.pctUsed).toBe(94);
    expect(d.sessions.map((s) => s.key)).toEqual(["claude/side/s-wedge"]);
  });

  it("an account with room is not near its limit and moves its own sessions", () => {
    const d = data.decision("claude/personal")!;
    expect(d.account).toBe("personal");
    expect(d.nearLimit).toBe(false);
    expect(d.sessions.every((s) => s.key.startsWith("claude/personal/"))).toBe(true);
    expect(d.sessions.map((s) => s.key)).not.toContain("claude/personal/s-notes");
  });
});
