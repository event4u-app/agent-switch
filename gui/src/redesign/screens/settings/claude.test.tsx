import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { setLangForTests } from "../../../i18n/index.js";
import { AcRoot } from "../../../ui/AcRoot.js";
import { emptyViewModel } from "../../../vm/load.js";
import { ASProvider } from "../../../vm/store.js";
import type { ClaudeSettingsStatus } from "../../../claude-settings.js";

const ipcMock = vi.hoisted(() => ({
  claudeSettings: vi.fn(),
  setClaudeSetting: vi.fn(async () => {}),
  setClaudeRule: vi.fn(async () => {}),
  syncClaudeSettings: vi.fn(async () => {}),
}));
vi.mock("../../../ipc.js", async (orig) => ({ ...(await orig<typeof import("../../../ipc.js")>()), ...ipcMock }));

import { ClaudeSettings } from "./claude.js";

const status = (over: Partial<ClaudeSettingsStatus> = {}): ClaudeSettingsStatus => ({
  file: "/Users/me/.claude/settings.json",
  exists: true,
  valid: true,
  settings: {
    env: { DISABLE_AUTOUPDATER: "1" },
    permissions: { allow: ["Bash(git *)", "Bash(ls *)", "Bash(make *)"], defaultMode: "auto" },
    model: "opus[1m]",
    enabledPlugins: { "lsp@market": true },
    hooks: { Stop: [{ hooks: [{ type: "command", command: "a" }, { type: "command", command: "b" }] }] },
    theme: "dark",
  },
  withheld: [],
  profiles: [
    { name: "work", state: "in-sync", extras: [] },
    { name: "side", state: "pending", extras: ["permissions.allow (+2)"] },
  ],
  ...over,
});

function mount() {
  return render(
    <AcRoot>
      <ASProvider initial={emptyViewModel()} actions={() => ({})}>
        <ClaudeSettings />
      </ASProvider>
    </AcRoot>,
  );
}

beforeEach(() => {
  setLangForTests("en");
  ipcMock.claudeSettings.mockResolvedValue(status());
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Settings › Claude Code", () => {
  it("shows the file, the accounts not yet up to date, and only Behaviour open", async () => {
    mount();
    expect(await screen.findByText("/Users/me/.claude/settings.json")).toBeTruthy();
    expect(screen.getByText("1 account not up to date")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Behaviour/ }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: /Allowed commands/ }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Bash(git *)")).toBeNull();
  });

  it("a switch writes the env value for every account and reloads", async () => {
    mount();
    const sw = await screen.findByRole("switch", { name: "No feedback survey" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("switch", { name: "No automatic updates" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(sw);
    await waitFor(() => expect(ipcMock.setClaudeSetting).toHaveBeenCalledWith("env.CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY", "1"));
    await waitFor(() => expect(ipcMock.claudeSettings).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("switch", { name: "No automatic updates" }));
    await waitFor(() => expect(ipcMock.setClaudeSetting).toHaveBeenCalledWith("env.DISABLE_AUTOUPDATER", undefined));
  });

  it("commands: catalog groups with checkboxes, the file's own rules in their own group, a group toggle sends each missing rule", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Allowed commands/ }));
    const git = screen.getByRole("checkbox", { name: "Bash(git *)" }) as HTMLInputElement;
    expect(git.checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: "Bash(make *)" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText("Your other rules")).toBeTruthy();
    fireEvent.click(git);
    await waitFor(() => expect(ipcMock.setClaudeRule).toHaveBeenCalledWith("allow", "Bash(git *)", false));
    const php = screen.getByText("PHP").closest("div")!.parentElement!;
    fireEvent.click(within(php).getByRole("button", { name: "All" }));
    await waitFor(() => expect(ipcMock.setClaudeRule).toHaveBeenCalledTimes(6));
    expect(ipcMock.setClaudeRule).toHaveBeenCalledWith("allow", "Bash(composer *)", true);
  });

  it("adds a typed rule only when it has the rule shape", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Allowed commands/ }));
    const field = screen.getByRole("textbox", { name: "Add rule" });
    const add = screen.getByRole("button", { name: "Add rule" });
    fireEvent.change(field, { target: { value: "not a rule" } });
    expect((add as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(field, { target: { value: "Bash(cargo *)" } });
    fireEvent.click(add);
    await waitFor(() => expect(ipcMock.setClaudeRule).toHaveBeenCalledWith("allow", "Bash(cargo *)", true));
  });

  it("the filter opens every matching section and hides the rest", async () => {
    mount();
    await screen.findByText("/Users/me/.claude/settings.json");
    fireEvent.change(screen.getByRole("textbox", { name: "Filter settings and commands" }), { target: { value: "gh pr" } });
    expect(screen.getByRole("checkbox", { name: "Bash(gh pr view*)" })).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: "Bash(ls *)" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Behaviour/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Plugins/ })).toBeNull();
  });

  it("accounts list each account's state and own values; hooks and other values are read-only", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Accounts/ }));
    expect(screen.getByText("applied at next start")).toBeTruthy();
    expect(screen.getByText("own: permissions.allow (+2)")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Hooks/ }));
    expect(screen.getByText("2 commands")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /More in the file/ }));
    expect(screen.getByText("theme")).toBeTruthy();
  });

  it("Apply now runs the sync; an unreadable CLI shows why instead of an empty page", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Apply now/ }));
    await waitFor(() => expect(ipcMock.syncClaudeSettings).toHaveBeenCalledTimes(1));
    cleanup();
    ipcMock.claudeSettings.mockRejectedValue(new Error("unknown command"));
    mount();
    expect(await screen.findByText(/could not be read/)).toBeTruthy();
  });
});
