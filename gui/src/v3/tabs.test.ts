import { describe, expect, it } from "vitest";
import {
  CLOSED_KEEP,
  EMPTY_TABS,
  arrange,
  canReopen,
  closable,
  closeOthers,
  closeTab,
  canShift,
  closeToLeft,
  closeToRight,
  closeUnpinned,
  shiftTab,
  moveTab,
  nextActive,
  openTab,
  pinTab,
  reopenTab,
  seedTabs,
  unpinTab,
  type TabState,
} from "./tabs.js";

const strip = (...ids: string[]): TabState => ids.reduce(openTab, EMPTY_TABS);
const all = () => true;

describe("tab strip state", () => {
  it("keeps the main tab first, then pinned tabs, then pages, then sessions, the user's order inside each", () => {
    expect(arrange(["s1", "page:tools", "s2", "page:library", "s3"], ["s2"], "s1")).toEqual(["s1", "s2", "page:tools", "page:library", "s3"]);
    // A new page opens after the open pages, before the sessions — never before the main tab.
    expect(openTab(strip("s1", "page:tools"), "page:library").order).toEqual(["s1", "page:tools", "page:library"]);
    expect(openTab(strip("s1", "page:tools", "s2"), "page:library").order).toEqual(["s1", "page:tools", "page:library", "s2"]);
    expect(openTab(strip("s1"), "s1")).toEqual(strip("s1"));
  });

  it("pins to the end of the pinned group, after the main tab, and unpins to the front of its own group", () => {
    let s = strip("s1", "page:tools", "s2", "s3", "s4");
    // s1 is the main tab: it does not pin.
    expect(pinTab(s, "s1")).toBe(s);
    s = pinTab(pinTab(s, "s4"), "s2");
    expect(s.order).toEqual(["s1", "s4", "s2", "page:tools", "s3"]);
    expect(s.pinned).toEqual(["s4", "s2"]);
    s = unpinTab(s, "s4");
    expect(s.order).toEqual(["s1", "s2", "page:tools", "s4", "s3"]);
    expect(pinTab(s, "nope")).toBe(s);
    expect(unpinTab(s, "s3")).toBe(s);
  });

  it("the plain close never takes a pinned tab; closing it by name does", () => {
    const s = pinTab(strip("s1", "s2"), "s2");
    expect(closeTab(s, "s2")).toBe(s);
    const forced = closeTab(s, "s2", true);
    expect(forced.order).toEqual(["s1"]);
    expect(forced.pinned).toEqual([]);
  });

  it("close others / to the right / all unpinned spare the pinned tabs and the main tab", () => {
    const s = pinTab(strip("s1", "s2", "s3", "s4"), "s4");
    // Order is now s1 (the main tab), s4 (pinned), s2, s3.
    expect(s.order).toEqual(["s1", "s4", "s2", "s3"]);
    expect(closeOthers(s, "s2").order).toEqual(["s1", "s4", "s2"]);
    expect(closeToRight(s, "s1").order).toEqual(["s1", "s4"]);
    expect(closeToRight(s, "s4").order).toEqual(["s1", "s4"]);
    expect(closeToLeft(s, "s3").order).toEqual(["s1", "s4", "s3"]);
    expect(closeUnpinned(s).order).toEqual(["s1", "s4"]);
    expect(closable(s, s.order)).toEqual(["s2", "s3"]);
  });

  it("reopens the last closed tab where it stood, pinned again if it was", () => {
    // s1 is the main tab and stays; s2 closes, then the pinned s3.
    let s = pinTab(strip("s1", "s2", "s3"), "s3");
    s = closeTab(s, "s2");
    s = closeTab(s, "s3", true);
    let r = reopenTab(s, all);
    expect(r.id).toBe("s3");
    expect(r.state.order).toEqual(["s1", "s3"]);
    expect(r.state.pinned).toEqual(["s3"]);
    r = reopenTab(r.state, all);
    expect(r.id).toBe("s2");
    expect(r.state.order).toEqual(["s1", "s3", "s2"]);
    expect(canReopen(r.state)).toBe(false);
    expect(reopenTab(r.state, all).id).toBeNull();
  });

  it("skips closed tabs that can no longer open and those open again", () => {
    let s = closeTab(closeTab(strip("s1", "s2", "s3"), "s1"), "s2");
    s = openTab(s, "s1");
    const r = reopenTab(s, (id) => id !== "s2");
    expect(r.id).toBeNull();
    expect(r.state.closed).toEqual([]);
  });

  it("remembers a bounded number of closed tabs", () => {
    const ids = Array.from({ length: CLOSED_KEEP + 5 }, (_, i) => `s${i}`);
    const s = closeUnpinned(strip(...ids));
    expect(s.closed).toHaveLength(CLOSED_KEEP);
    expect(s.closed.at(-1)?.id).toBe(ids.at(-1));
  });

  it("drags inside a group, and a drop into another group stops at the group's edge; the main tab stays first", () => {
    const s = pinTab(strip("s1", "page:tools", "page:library", "s2", "s3", "s4"), "s4");
    // s1 (main), s4 (pinned), tools, library, s2, s3
    expect(s.order).toEqual(["s1", "s4", "page:tools", "page:library", "s2", "s3"]);
    expect(moveTab(s, "s3", "s2", "before").order).toEqual(["s1", "s4", "page:tools", "page:library", "s3", "s2"]);
    expect(moveTab(s, "page:tools", "page:library", "after").order).toEqual(["s1", "s4", "page:library", "page:tools", "s2", "s3"]);
    // A session dropped onto the pinned tab goes to the front of the sessions, not before it.
    expect(moveTab(s, "s3", "s4", "before").order).toEqual(["s1", "s4", "page:tools", "page:library", "s3", "s2"]);
    // A page dropped among the sessions goes to the end of the pages.
    expect(moveTab(s, "page:tools", "s2", "after").order).toEqual(["s1", "s4", "page:library", "page:tools", "s2", "s3"]);
    // Nothing goes before the main tab, and the main tab does not move.
    expect(moveTab(s, "s4", "s1", "before").order).toEqual(s.order);
    expect(moveTab(s, "s2", "s1", "before").order[0]).toBe("s1");
    expect(moveTab(s, "s1", "s3", "after")).toBe(s);
    expect(moveTab(s, "s2", "s2", "after")).toBe(s);
  });

  it("moves a tab one step left or right inside its group; the main tab and the group edges stay", () => {
    const s = pinTab(strip("s1", "s2", "s3"), "s3");
    // s1 (main), s3 (pinned), s2
    expect(shiftTab(s, "s1", 1)).toBe(s);
    expect(canShift(s, "s3", -1)).toBe(false);
    expect(canShift(s, "s2", -1)).toBe(false);
    const t = openTab(s, "s4");
    expect(shiftTab(t, "s4", -1).order).toEqual(["s1", "s3", "s4", "s2"]);
    expect(canShift(t, "s4", 1)).toBe(false);
  });

  it("seeds saved tabs and keeps only pinned ids that are open", () => {
    const s = seedTabs(EMPTY_TABS, ["s1", "s2"], ["s2", "gone"]);
    expect(s.order).toEqual(["s1", "s2"]);
    expect(s.pinned).toEqual(["s2"]);
  });

  it("after a close, the tab now at its place becomes active", () => {
    expect(nextActive(["a", "b", "c"], ["a", "c"], "b", "b")).toBe("c");
    expect(nextActive(["a", "b", "c"], ["a", "b"], "c", "c")).toBe("b");
    expect(nextActive(["a", "b"], ["a"], "b", "a")).toBe("a");
    expect(nextActive(["a", "b", "c"], ["c"], "a", "b")).toBe("c");
    expect(nextActive(["a"], [], "a", "a")).toBeNull();
  });
});

describe("the default tab and more tabs of one session (owner, 2026-11-25)", () => {
  it("opens in the main tab (the first unpinned one, page or session), in place; a session with a tab goes to it", async () => {
    const { openInDefault, EMPTY_TABS: E } = await import("./tabs.js");
    const s = { ...E, order: ["p1", "page:library", "a", "b"], pinned: ["p1"] };
    const r = openInDefault(s, "c");
    expect(r.id).toBe("c");
    // The session takes the main tab's place (here a page), and the main tab is first.
    expect(r.state.order).toEqual(["c", "p1", "a", "b"]);
    expect(openInDefault(r.state, "b")).toEqual({ state: r.state, id: "b" });
    expect(openInDefault(E, "x").state.order).toEqual(["x"]);
  });

  it("another tab of a session is a copy right after the asked one; sessionOf reads either id", async () => {
    const { openAnother, sessionOf, EMPTY_TABS: E } = await import("./tabs.js");
    const s = { ...E, order: ["a", "b"] };
    const one = openAnother(s, "a", "a");
    expect(one).toEqual({ state: { ...s, order: ["a", "a#2", "b"] }, id: "a#2" });
    expect(openAnother(one.state, "a", "a#2").id).toBe("a#3");
    expect(openAnother(s, "c").state.order).toEqual(["a", "b", "c"]);
    expect([sessionOf("a#2"), sessionOf("a"), sessionOf("page:x")]).toEqual(["a", "a", "page:x"]);
  });
});

describe("pages open in the main tab too (owner, 2026-11-26)", () => {
  it("Arenas, Settings… take the main tab's place; an open page goes to its tab; a new tab only when asked", async () => {
    const { openInDefault, openTab, mainTab, EMPTY_TABS: E } = await import("./tabs.js");
    let s = openTab(openTab(E, "a"), "b");
    let r = openInDefault(s, "page:arenas");
    expect(r.state.order).toEqual(["page:arenas", "b"]);
    expect(mainTab(r.state)).toBe("page:arenas");
    r = openInDefault(r.state, "page:settings");
    expect(r.state.order).toEqual(["page:settings", "b"]);
    // Asked for a tab of its own: the main tab keeps what it shows.
    s = openTab(r.state, "page:arenas");
    expect(s.order).toEqual(["page:settings", "page:arenas", "b"]);
    expect(openInDefault(s, "page:arenas")).toEqual({ state: s, id: "page:arenas" });
    // A session opens in the main tab, in place of the page there.
    expect(openInDefault(s, "a").state.order).toEqual(["a", "page:arenas", "b"]);
  });
});

describe("the main tab cannot be closed (owner, 2026-11-25)", () => {
  it("no close path takes the first unpinned session tab", async () => {
    const { closeTab, closeOthers, closeUnpinned, closable, mainTab, EMPTY_TABS: E } = await import("./tabs.js");
    const s = { ...E, order: ["p", "a", "page:library", "b"], pinned: ["p"] };
    expect(mainTab(s)).toBe("a");
    expect(closeTab(s, "a", true).order).toContain("a");
    expect(closeOthers(s, "b").order).toEqual(["a", "p", "b"]);
    expect(closeUnpinned(s).order).toEqual(["a", "p"]);
    expect(closable(s, ["a", "b"])).toEqual(["b"]);
  });
});
