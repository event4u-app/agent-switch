import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppearanceSettings, OpenInSettings, SETTINGS_NAV, SettingsPage, pickTheme } from "./settings.js";
import { DEFAULT_APPEARANCE } from "./themes/resolve.js";
import { THEMES, themeById } from "./themes/registry.js";

afterEach(cleanup);

describe("Settings (spec §10.5)", () => {
  it("the left nav marks the current section; Agents and Remote wait for v3.2", () => {
    const onSection = vi.fn();
    render(
      <SettingsPage current="Appearance" onSection={onSection}>
        <p>body</p>
      </SettingsPage>,
    );
    expect(screen.getByRole("button", { name: "Appearance" }).getAttribute("aria-current")).toBe("page");
    expect(SETTINGS_NAV).not.toContain("Agents");
    expect(SETTINGS_NAV).not.toContain("Remote");
    fireEvent.click(screen.getByRole("button", { name: "Open in" }));
    expect(onSection).toHaveBeenCalledWith("Open in");
  });

  it("picking a theme fills the slot of its own mode; Sync with OS keeps both", () => {
    const light = THEMES.find((t) => t.mode === "light" && t.id !== DEFAULT_APPEARANCE.light)!;
    expect(pickTheme(DEFAULT_APPEARANCE, light)).toMatchObject({ mode: "light", light: light.id, dark: DEFAULT_APPEARANCE.dark });
    expect(pickTheme({ ...DEFAULT_APPEARANCE, mode: "system" }, light).mode).toBe("system");
  });

  it("Appearance: every theme as a live mini preview in its group; accent, terminal, About", () => {
    const onChange = vi.fn();
    render(<AppearanceSettings a={DEFAULT_APPEARANCE} prefersDark onChange={onChange} />);
    for (const g of ["JetBrains", "Popular", "Accessibility"]) expect(screen.getByText(g)).toBeTruthy();
    expect(screen.getAllByText("Agent Switch").length).toBeGreaterThan(1); // the group and the accent option
    expect(screen.getAllByRole("button", { pressed: true })).toHaveLength(1);
    const other = THEMES.find((t) => t.mode === "dark" && t.id !== DEFAULT_APPEARANCE.dark)!;
    fireEvent.click(screen.getByText(other.name).closest("button")!);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ dark: other.id }));
    fireEvent.click(screen.getByRole("radio", { name: /Agent Switch/ }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ accent: "agent-switch" }));
    expect(screen.getByText(`About ${themeById(DEFAULT_APPEARANCE.dark).name}`)).toBeTruthy();
  });

  it("Open in: missing apps are hidden from the default; Focus terminal is a switch", () => {
    const on = { setDefault: vi.fn(), focusTerminal: vi.fn() };
    render(<OpenInSettings defaultTarget="vscode" perRepo={{ "~/code/web": "phpstorm" }} focusTerminal on={on} targets={[{ target: "vscode", label: "VS Code", kind: "editor", installed: true }, { target: "phpstorm", label: "PhpStorm", kind: "editor", installed: true }, { target: "cursor", label: "Cursor", kind: "editor", installed: false }]} />);
    expect(screen.getByText("not installed · hidden")).toBeTruthy();
    expect(screen.getByText("~/code/web")).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Focus terminal" }));
    expect(on.focusTerminal).toHaveBeenCalledWith(false);
  });
});
