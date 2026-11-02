import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Act, AccountMark, BatchBar, Chip, Disclosure, Later, Marker, PageHeader, age, checkedAgo, duration, pct, resetIn } from "./kit.js";

const MIN = 60_000;
const H = 60 * MIN;

describe("one format everywhere (spec §3.6)", () => {
  it("percent, durations, reset and age", () => {
    expect(pct(94)).toBe("94%");
    expect(pct(93.6)).toBe("94%");
    expect(pct(null)).toBe("—");
    expect(duration(45_000)).toBe("45s");
    expect(duration(5 * MIN)).toBe("5m");
    expect(duration(5 * H)).toBe("5h");
    expect(duration(H + 18 * MIN)).toBe("1h 18m");
    expect(duration(2 * 24 * H + 5 * H + 7 * MIN)).toBe("2d 5h");
    expect(duration(-5)).toBe("0s");
    expect(resetIn(H + 18 * MIN)).toBe("↻ 1h 18m");
    expect(age(14 * MIN)).toBe("14m old");
    expect(checkedAgo(20_000)).toBe("checked just now");
    expect(checkedAgo(MIN)).toBe("checked 1m ago");
  });
});

describe("kit primitives keep one look per meaning (spec §3)", () => {
  it("three chip kinds: tinted status, outlined meta, plain tag", () => {
    const { container } = render(
      <>
        <Chip kind="status" tone="warn">Near limit</Chip>
        <Chip kind="meta">Default</Chip>
        <Chip kind="tag">docs</Chip>
      </>,
    );
    const [status, meta, tag] = Array.from(container.querySelectorAll("span"));
    expect(status.className).toContain("bg-ac-warn-tint");
    expect(meta.className).toContain("border-ac-line2");
    expect(tag.className).toContain("bg-ac-raise");
    for (const c of [status, meta, tag]) expect(c.className).toContain("rounded ");
  });

  it("the Marker is a frame with an accent leading edge, never an inset shadow", () => {
    const { container } = render(<Marker />);
    const m = container.firstElementChild!;
    expect(m.className).toMatch(/border-l-2/);
    expect(m.className).toMatch(/border-l-ac-brand/);
    expect(m.className).not.toMatch(/shadow-\[inset/);
    expect(render(<Marker tone="warn" />).container.firstElementChild!.className).toMatch(/border-l-ac-warn/);
  });

  it("an account is a tick in its colour, not a dot", () => {
    const { container } = render(<AccountMark color="teal" />);
    expect(container.firstElementChild!.className).toMatch(/h-3 w-\[3px\]/);
  });

  it("buttons, Later, Disclosure and the batch bar call their handlers", () => {
    const act = vi.fn();
    render(<Act kind="accent" kbd="⌘↵" onClick={act}>Send to agent</Act>);
    fireEvent.click(screen.getByText("Send to agent"));
    expect(act).toHaveBeenCalledOnce();
    expect(screen.getByText("⌘↵").className).toMatch(/opacity-70/);

    const later = vi.fn();
    render(<Later onClick={later} />);
    fireEvent.click(screen.getByTitle(/Later \(L\)/));
    expect(later).toHaveBeenCalledOnce();

    const toggle = vi.fn();
    render(<Disclosure label="Why?" onToggle={toggle} />);
    fireEvent.click(screen.getByText("Why?"));
    expect(toggle).toHaveBeenCalledOnce();

    const actions = { onClear: vi.fn(), onPin: vi.fn(), onArchive: vi.fn(), onClean: vi.fn(), onEnd: vi.fn() };
    render(<BatchBar count={3} actions={actions} />);
    expect(screen.getByText("3 selected")).toBeTruthy();
    fireEvent.click(screen.getByText("Pin"));
    fireEvent.click(screen.getByText("Archive"));
    fireEvent.click(screen.getByText("Clean worktrees"));
    fireEvent.click(screen.getByText("End…"));
    expect([actions.onPin, actions.onArchive, actions.onClean, actions.onEnd].every((f) => f.mock.calls.length === 1)).toBe(true);
  });

  it("one page header: 20 px title, muted sub, actions on the right", () => {
    render(<PageHeader title="Accounts" sub="Each sign-in" actions={<Act>Add</Act>} />);
    expect(screen.getByText("Accounts").className).toMatch(/text-\[20px\]/);
    expect(screen.getByText("Each sign-in").className).toMatch(/text-ac-muted/);
  });
});
