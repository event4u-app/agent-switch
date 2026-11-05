import { describe, expect, it } from "vitest";
import {
  CLOSED_KEEP,
  EMPTY_TABS,
  arrange,
  canReopen,
  closable,
  closeOthers,
  closeTab,
  closeToRight,
  closeUnpinned,
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
  it("keeps pinned tabs first, then pages, then sessions, the user's order inside each", () => {
    expect(arrange(["s1", "page:tools", "s2", "page:library"], ["s2"])).toEqual(["s2", "page:tools", "page:library", "s1"]);
    // A new page opens after the open pages, before the sessions.
    expect(openTab(strip("s1", "page:tools"), "page:library").order).toEqual(["page:tools", "page:library", "s1"]);
    expect(openTab(strip("s1"), "s1")).toEqual(strip("s1"));
  });

  it("pins to the end of the pinned group and unpins to the front of its own group", () => {
    let s = strip("page:tools", "s1", "s2", "s3");
    s = pinTab(pinTab(s, "s3"), "s1");
    expect(s.order).toEqual(["s3", "s1", "page:tools", "s2"]);
    expect(s.pinned).toEqual(["s3", "s1"]);
    s = unpinTab(s, "s3");
    expect(s.order).toEqual(["s1", "page:tools", "s3", "s2"]);
    expect(pinTab(s, "nope")).toBe(s);
    expect(unpinTab(s, "s2")).toBe(s);
  });

  it("the plain close never takes a pinned tab; closing it by name does", () => {
    const s = pinTab(strip("s1", "s2"), "s1");
    expect(closeTab(s, "s1")).toBe(s);
    const forced = closeTab(s, "s1", true);
    expect(forced.order).toEqual(["s2"]);
    expect(forced.pinned).toEqual([]);
  });

  it("close others / to the right / all unpinned spare the pinned tabs", () => {
    const s = pinTab(strip("s1", "s2", "s3", "s4"), "s4");
    // Order is now s4 (pinned), s1, s2, s3.
    expect(closeOthers(s, "s2").order).toEqual(["s4", "s2"]);
    expect(closeToRight(s, "s1").order).toEqual(["s4", "s1"]);
    expect(closeToRight(s, "s4").order).toEqual(["s4"]);
    expect(closeUnpinned(s).order).toEqual(["s4"]);
    expect(closable(s, s.order)).toEqual(["s1", "s2", "s3"]);
  });

  it("reopens the last closed tab where it stood, pinned again if it was", () => {
    let s = pinTab(strip("s1", "s2", "s3"), "s3");
    s = closeTab(s, "s1");
    s = closeTab(s, "s3", true);
    let r = reopenTab(s, all);
    expect(r.id).toBe("s3");
    expect(r.state.order).toEqual(["s3", "s2"]);
    expect(r.state.pinned).toEqual(["s3"]);
    r = reopenTab(r.state, all);
    expect(r.id).toBe("s1");
    expect(r.state.order).toEqual(["s3", "s1", "s2"]);
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

  it("drags inside a group, and a drop into another group stops at the group's edge", () => {
    const s = pinTab(strip("page:tools", "page:library", "s1", "s2", "s3"), "s3");
    // s3 (pinned), tools, library, s1, s2
    expect(moveTab(s, "s2", "s1", "before").order).toEqual(["s3", "page:tools", "page:library", "s2", "s1"]);
    expect(moveTab(s, "page:tools", "page:library", "after").order).toEqual(["s3", "page:library", "page:tools", "s1", "s2"]);
    // A session dropped onto the pinned tab goes to the front of the sessions, not before it.
    expect(moveTab(s, "s2", "s3", "before").order).toEqual(["s3", "page:tools", "page:library", "s2", "s1"]);
    // A page dropped among the sessions goes to the end of the pages.
    expect(moveTab(s, "page:tools", "s2", "after").order).toEqual(["s3", "page:library", "page:tools", "s1", "s2"]);
    expect(moveTab(s, "s1", "s1", "after")).toBe(s);
  });

  it("seeds saved tabs and keeps only pinned ids that are open", () => {
    const s = seedTabs(EMPTY_TABS, ["s1", "s2"], ["s2", "gone"]);
    expect(s.order).toEqual(["s2", "s1"]);
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
