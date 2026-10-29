import { describe, expect, it, vi } from "vitest";
import { PET_WELCOME } from "./model.js";
import { claimPetWelcome } from "./welcome.js";

describe("PET_WELCOME", () => {
  it("is byte-exact (owner constraint: the intro text never changes)", () => {
    expect(PET_WELCOME).toBe(
      "agent-switch is installed! The name's Switch — Agent Switch. I like my AIs switched, not stirred. Toggle me anytime in the Pet settings.",
    );
    // UTF-8 length pins the em dash (3 bytes) against a hyphen or an en dash.
    expect(new TextEncoder().encode(PET_WELCOME).length).toBe(138);
  });
});

function deps(file: boolean | undefined, legacy: boolean) {
  return {
    readFileFlag: vi.fn(async () => file),
    writeFileFlag: vi.fn(async () => {}),
    legacyWelcomed: vi.fn(() => legacy),
    markLegacy: vi.fn(),
  };
}

describe("claimPetWelcome (D36: once-flag lives in the GUI settings file)", () => {
  it("first launch: claims the intro and persists the flag before showing it", async () => {
    const d = deps(false, false);
    expect(await claimPetWelcome(d)).toBe(true);
    expect(d.writeFileFlag).toHaveBeenCalledTimes(1);
    expect(d.markLegacy).toHaveBeenCalled();
  });

  it("already welcomed in the file: never again, even if localStorage was wiped", async () => {
    const d = deps(true, false);
    expect(await claimPetWelcome(d)).toBe(false);
    expect(d.writeFileFlag).not.toHaveBeenCalled();
  });

  it("migrates the old localStorage flag into the file without showing the intro", async () => {
    const d = deps(false, true);
    expect(await claimPetWelcome(d)).toBe(false);
    expect(d.writeFileFlag).toHaveBeenCalledTimes(1);
  });

  it("file unreadable: falls back to the legacy flag and still never shows twice", async () => {
    const seen = deps(undefined, true);
    expect(await claimPetWelcome(seen)).toBe(false);
    const fresh = deps(undefined, false);
    expect(await claimPetWelcome(fresh)).toBe(true);
    expect(fresh.markLegacy).toHaveBeenCalled();
  });

  it("a failing write never throws into the UI", async () => {
    const d = { ...deps(false, false), writeFileFlag: vi.fn(async () => { throw new Error("cli missing"); }) };
    expect(await claimPetWelcome(d)).toBe(true);
    expect(d.markLegacy).toHaveBeenCalled();
  });
});
