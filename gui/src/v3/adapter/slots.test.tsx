import { describe, expect, it } from "vitest";
import { isValidElement, type ReactElement } from "react";
import { settingsSection } from "./slots.js";
import { SETTINGS_NAV } from "../settings.js";

describe("2.11 settings screens inside the v3 settings page", () => {
  // The 2.11 screens return their groups as a fragment and leave the spacing to
  // their parent column (flex-col gap-5). Dropped in raw, the section captions
  // ("USAGE LIMITS", "PRIVACY") sat flush between two cards.
  it.each(SETTINGS_NAV.filter((s) => !["Appearance", "Open in", "Agents", "Remote"].includes(s)))("%s keeps the 2.11 column spacing", (section) => {
    const el = settingsSection(section);
    expect(isValidElement(el)).toBe(true);
    expect(String((el as ReactElement<{ className?: string }>).props.className)).toMatch(/\bflex-col\b.*\bgap-5\b/);
  });

  it("v3's own sections stay out of it", () => {
    expect(settingsSection("Appearance")).toBeNull();
  });
});
