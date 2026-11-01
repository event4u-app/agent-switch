import { afterEach, describe, expect, it } from "vitest";
import { setLangForTests } from "../../i18n/index.js";
import { localizeNoticeText, localizeNotification, noticeEn } from "./notice-text.js";

afterEach(() => setLangForTests("en"));

describe("notice text", () => {
  it("writes the canonical English whatever the live language", () => {
    setLangForTests("de");
    expect(noticeEn("engines.notice.switchedBody", { tool: "Claude", name: "work" })).toBe("Claude is now using work.");
  });

  it("leaves English untouched", () => {
    expect(localizeNoticeText("Updated to v1.2.3")).toBe("Updated to v1.2.3");
  });

  it("translates what the GUI logged, keeping the logged values", () => {
    setLangForTests("de");
    expect(localizeNoticeText(noticeEn("engines.notice.updatedTitle", { tag: "v1.2.3" }))).toBe("Auf v1.2.3 aktualisiert");
    const msg = noticeEn("engines.notice.limitNearRebind", { tool: "claude", account: "work", threshold: "90", target: "home" });
    expect(localizeNoticeText(msg)).toBe(
      "claude/work hat ≥90\u00a0% erreicht – Vorschlag: claude/home. Wechsle mit `agent-switch rebind` (kein automatischer Wechsel).",
    );
    const hl = noticeEn("engines.notice.agentConfigBodyHighlight", { current: "1.0", latest: "1.1", highlight: "Faster sync" });
    expect(localizeNoticeText(hl)).toBe("v1.0 → v1.1 – Faster sync · Neuigkeiten unter Tools → agent-config.");
    expect(localizeNoticeText(noticeEn("engines.notice.agentConfigTitle"))).toBe("agent-config-Update verfügbar");
    expect(localizeNoticeText(noticeEn("engines.notice.toolUpdateTitle", { tool: "rtk" }))).toBe("rtk: Update verfügbar");
  });

  it("shows text it does not know as logged", () => {
    setLangForTests("de");
    expect(localizeNotification({ title: "Claude finished", message: "work finished its turn." })).toEqual({
      title: "Claude finished",
      message: "work finished its turn.",
    });
  });
});
