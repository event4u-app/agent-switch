/** Proposal C: where a session runs is the bar's chip; Focus terminal, Take over and Copy conversation lead ⋯. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { V3Window, type V3Data } from "./window.js";
import { data, slots } from "./window-fixture.js";
import { useCopySource } from "./copy-source.js";

afterEach(cleanup);

function Source({ k, copy }: { k: string; copy: () => Promise<void> }) {
  useCopySource(k, copy);
  return null;
}

function mount(over: Partial<V3Data> = {}, copy?: () => Promise<void>) {
  const act = vi.fn();
  const d = data();
  render(
    <>
      {copy && <Source k="s1" copy={copy} />}
      <V3Window data={{ ...d, ...over }} slots={slots} act={act} platform="mac" />
    </>,
  );
  fireEvent.click(screen.getByRole("button", { name: /Session actions/ }));
  return { act, menu: screen.getByRole("menu", { name: "Session actions" }) };
}

const elsewhere = (d = data()) => ({ bar: (k: string) => ({ ...d.bar(k)!, hosted: false, where: "iTerm2", focusable: true }) });

describe("slimmer session header (proposal C)", () => {
  it("a session in your terminal: Focus terminal, Take over with what it changes, then the rest", () => {
    const { act, menu } = mount(elsewhere());
    const items = within(menu).getAllByRole("menuitem").map((i) => i.textContent);
    expect(items[0]).toMatch(/^Focus terminal/);
    expect(items[1]).toMatch(/^Take over here…/);
    expect(within(menu).getByText("The same conversation continues here on this account and stops running in iTerm2.")).toBeTruthy();
    fireEvent.click(within(menu).getByRole("menuitem", { name: /^Focus terminal/ }));
    expect(act).toHaveBeenCalledWith({ type: "open-in", key: "s1", pick: { kind: "focus" } });
  });

  it("Copy conversation is offered when the session's view can copy, and copies", () => {
    const copy = vi.fn(() => Promise.resolve());
    const { menu } = mount({}, copy);
    fireEvent.click(within(menu).getByRole("menuitem", { name: /^Copy conversation/ }));
    expect(copy).toHaveBeenCalledOnce();
  });

  it("without a view to copy from, no Copy conversation; a hosted session keeps Take over in its usual place", () => {
    const { menu } = mount();
    expect(within(menu).queryByRole("menuitem", { name: /^Copy conversation/ })).toBeNull();
    expect(within(menu).getAllByRole("menuitem")[0].textContent).toMatch(/^Rename/);
  });
});
