import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { HintStrip, type BarSession } from "./workbench.js";

afterEach(cleanup);

const bar = (o: Partial<BarSession> = {}): BarSession => ({
  key: "claude/work/1",
  hosted: true,
  chatAvailable: true,
  view: "chat",
  account: { name: "work", color: "teal", fiveH: 20, protect: 95 },
  model: "Opus",
  thinking: null,
  contextPct: 72,
  tool: "claude",
  contextTokens: 660_200,
  cache: null,
  ...o,
});

describe("HintStrip (6.2)", () => {
  it("shows the most pressing hint with its action and a count of the rest", () => {
    const onAction = vi.fn();
    render(<HintStrip s={bar({ account: { name: "work", color: "teal", fiveH: 90, protect: 95 } })} dismissed={new Set()} onDismiss={() => {}} onAction={onAction} />);
    expect(screen.getByRole("status").getAttribute("data-hint")).toBe("limit");
    expect(screen.getByText("+1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Move/ }));
    expect(onAction.mock.calls[0]![0].action.kind).toBe("switch");
  });

  it("dismissing hides that hint for this session and state; the next one comes forward", () => {
    const onDismiss = vi.fn();
    const s = bar({ account: { name: "work", color: "teal", fiveH: 90, protect: 95 } });
    const { rerender } = render(<HintStrip s={s} dismissed={new Set()} onDismiss={onDismiss} onAction={() => {}} />);
    fireEvent.click(screen.getByLabelText("Dismiss hint"));
    const key = onDismiss.mock.calls[0]![0] as string;
    expect(key.startsWith("claude/work/1|limit:")).toBe(true);
    rerender(<HintStrip s={s} dismissed={new Set([key])} onDismiss={onDismiss} onAction={() => {}} />);
    expect(screen.getByRole("status").getAttribute("data-hint")).toBe("context");
    expect(screen.getByText(/660k/)).toBeTruthy();
  });

  it("nothing to say → no strip", () => {
    const { container } = render(<HintStrip s={bar({ contextPct: 10, contextTokens: 20_000 })} dismissed={new Set()} onDismiss={() => {}} onAction={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});
