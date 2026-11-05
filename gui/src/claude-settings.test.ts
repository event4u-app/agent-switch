import { describe, expect, it } from "vitest";
import { RULE_GROUPS, groupToggle, hookSummary, otherValues, parseClaudeSettings, ruleGroups, validRule } from "./claude-settings.js";

describe("claude settings model", () => {
  it("parses the CLI status defensively", () => {
    const s = parseClaudeSettings({ file: "/f", exists: true, settings: { a: 1 }, withheld: ["x", 2], profiles: [{ name: "w", state: "weird", extras: ["k"] }, null] });
    expect(s).toEqual({ file: "/f", exists: true, valid: true, settings: { a: 1 }, withheld: ["x"], profiles: [{ name: "w", state: "invalid", extras: ["k"] }] });
    expect(parseClaudeSettings(null).profiles).toEqual([]);
  });

  it("ruleGroups marks catalog rules and collects the rest under other", () => {
    const allow = [RULE_GROUPS[0]!.rules[0]!, "Bash(make *)"];
    const groups = ruleGroups(allow);
    expect(groups[0]!.on).toBe(1);
    expect(groups.find((g) => g.id === "other")!.rules).toEqual([{ rule: "Bash(make *)", on: true }]);
    expect(ruleGroups([]).some((g) => g.id === "other")).toBe(false);
    const total = RULE_GROUPS.reduce((n, g) => n + g.rules.length, 0);
    expect(groups.filter((g) => g.id !== "other").reduce((n, g) => n + g.rules.length, 0)).toBe(total);
  });

  it("groupToggle sends only the rules whose state changes", () => {
    const g = ruleGroups(["Bash(npm *)"]).find((x) => x.id === "js")!;
    expect(groupToggle(g, true)).toEqual(g.rules.filter((r) => r.rule !== "Bash(npm *)").map((r) => r.rule));
    expect(groupToggle(g, false)).toEqual(["Bash(npm *)"]);
  });

  it("validRule accepts Tool and Tool(spec), nothing multi-line or loose", () => {
    for (const ok of ["Read", "Bash(git *)", "WebFetch(domain:example.com)", "mcp__srv__tool"]) expect(validRule(ok)).toBe(true);
    for (const bad of ["", "not a rule", "Bash(", "Bash(x)\nRead", "(x)"]) expect(validRule(bad)).toBe(false);
  });

  it("hookSummary counts commands per event; otherValues lists the rest compactly", () => {
    expect(hookSummary({ hooks: { Stop: [{ hooks: [{}, {}] }, { hooks: [{}] }], Bad: "x" } })).toEqual([{ event: "Stop", commands: 3 }, { event: "Bad", commands: 0 }]);
    const long = "x".repeat(200);
    const v = otherValues({ env: {}, theme: "dark", note: long });
    expect(v.map((x) => x.key)).toEqual(["theme", "note"]);
    expect(v[1]!.preview.length).toBe(80);
  });
});
