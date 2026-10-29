import { describe, expect, it } from "vitest";
import { expandHome, folderProblem, typedFolder } from "./paths.js";

describe("typed folder paths", () => {
  it("expands a leading ~ to the home dir", () => {
    expect(expandHome("~", "/Users/ada")).toBe("/Users/ada");
    expect(expandHome("~/dev/app", "/Users/ada")).toBe("/Users/ada/dev/app");
    expect(expandHome("~/dev/app", "/Users/ada/")).toBe("/Users/ada/dev/app");
    expect(expandHome("/abs/~/x", "/Users/ada")).toBe("/abs/~/x");
    expect(expandHome("~other/x", "/Users/ada")).toBe("~other/x");
  });

  it("leaves ~ alone when the home dir is unknown", () => {
    expect(expandHome("~/dev", null)).toBe("~/dev");
  });

  it("rejects a path that starts with -, which the CLI would read as a flag", () => {
    expect(folderProblem("-rf")).not.toBeNull();
    expect(folderProblem("  --cwd")).not.toBeNull();
    expect(folderProblem("/ok/-dash")).toBeNull();
    expect(folderProblem("")).toBeNull();
  });

  it("typedFolder trims, expands, and refuses a flag-shaped path", () => {
    expect(typedFolder("  ~/dev  ", "/Users/ada")).toEqual({ ok: true, path: "/Users/ada/dev" });
    expect(typedFolder("-x", "/Users/ada")).toMatchObject({ ok: false });
    expect(typedFolder("   ", "/Users/ada")).toMatchObject({ ok: false });
  });
});
