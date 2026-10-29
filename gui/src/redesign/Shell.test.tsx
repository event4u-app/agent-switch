import { afterEach, describe, it, expect } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AcRoot } from "../ui/AcRoot.js";
import { accountFromProfile } from "../vm/build.js";
import { emptyViewModel } from "../vm/load.js";
import { ASProvider, useAS } from "../vm/store.js";
import { CommandSearch } from "./CommandSearch.js";
import { Shell } from "./Shell.js";
import { isAppShortcut } from "./shortcuts.js";

function ScreenName() {
  const s = useAS();
  return <p data-testid="where">{`${s.screen}/${s.overlay.kind}`}</p>;
}

function renderShell(over: Partial<ReturnType<typeof emptyViewModel>> = {}) {
  const vm = {
    ...emptyViewModel(),
    ...over,
    accounts: [
      accountFromProfile({ provider: "claude", name: "work", identity: null, label: null, active: true, liveSessions: 0 }, null),
    ],
    readiness: "ready" as const,
    ...(over.readiness ? { readiness: over.readiness } : {}),
  };
  return render(
    <AcRoot>
      <ASProvider initial={vm}>
        <Shell isMac>
          <ScreenName />
        </Shell>
      </ASProvider>
    </AcRoot>,
  );
}

describe("redesign shell", () => {
  afterEach(cleanup);

  it("renders the drag-region top bar with the macOS inset and the four places", () => {
    renderShell();
    const bar = document.querySelector("header[data-tauri-drag-region]")!;
    expect(bar.className).toContain("pl-[84px]");
    expect(screen.getByRole("navigation", { name: "Places" }).querySelectorAll("button")).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Health: Ready" })).toBeTruthy();
  });

  it("the Health pill counts only warn + fail checks, like the Health screen", () => {
    renderShell({
      checks: [
        { id: "a", title: "A", detail: "", state: "ok" },
        { id: "b", title: "B", detail: "", state: "info" },
        { id: "c", title: "C", detail: "", state: "warn" },
        { id: "d", title: "D", detail: "", state: "fail" },
      ],
    });
    expect(screen.getByRole("button", { name: "Health: Ready, 2 to check" })).toBeTruthy();
    cleanup();
    renderShell({ checks: [{ id: "b", title: "B", detail: "", state: "info" }] });
    expect(screen.getByRole("button", { name: "Health: Ready" })).toBeTruthy();
  });

  it("navigates and opens overlays from the bar and the shortcuts", () => {
    renderShell();
    fireEvent.click(screen.getByTitle("Sessions"));
    expect(screen.getByTestId("where").textContent).toBe("sessions/none");
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    expect(screen.getByTestId("where").textContent).toBe("sessions/notifications");
    act(() => {
      fireEvent.keyDown(window, { key: ",", metaKey: true });
    });
    expect(screen.getByTestId("where").textContent).toBe("settings/none");
    act(() => {
      fireEvent.keyDown(window, { key: "n", metaKey: true });
    });
    expect(screen.getByTestId("where").textContent).toBe("settings/start");
  });

  it("finds an account through command search and opens its sheet", () => {
    render(
      <AcRoot>
        <ASProvider
          initial={{
            ...emptyViewModel(),
            accounts: [
              accountFromProfile({ provider: "claude", name: "work", identity: null, label: null, active: true, liveSessions: 0 }, null),
            ],
          }}
        >
          <CommandSearch collapsed={false} />
          <ScreenName />
        </ASProvider>
      </AcRoot>,
    );
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "work" } });
    expect(screen.getByRole("option", { name: /Claude · work/ })).toBeTruthy();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByTestId("where").textContent).toBe("home/account");
  });

  it("app shortcuts use ⌘ on macOS and Ctrl elsewhere, never with keys typed into the terminal", () => {
    const key = (init: KeyboardEventInit, target?: Element) => {
      const e = new KeyboardEvent("keydown", init);
      if (target) Object.defineProperty(e, "target", { value: target });
      return e;
    };
    expect(isAppShortcut(key({ key: "n", metaKey: true }), true)).toBe(true);
    expect(isAppShortcut(key({ key: "n", ctrlKey: true }), true)).toBe(false);
    expect(isAppShortcut(key({ key: "n", ctrlKey: true }), false)).toBe(true);
    expect(isAppShortcut(key({ key: "n", metaKey: true }), false)).toBe(false);
    expect(isAppShortcut(key({ key: "n", metaKey: true, shiftKey: true }), true)).toBe(false);
    const term = document.createElement("div");
    term.setAttribute("data-terminal", "");
    const textarea = document.createElement("textarea");
    term.appendChild(textarea);
    expect(isAppShortcut(key({ key: "n", ctrlKey: true }, textarea), false)).toBe(false);
  });

  it("Ctrl+N on macOS and ⌘K/⌘N typed inside the terminal do nothing", () => {
    renderShell();
    act(() => {
      fireEvent.keyDown(window, { key: "n", ctrlKey: true });
    });
    expect(screen.getByTestId("where").textContent).toBe("home/none");
    const term = document.createElement("div");
    term.setAttribute("data-terminal", "");
    const ta = document.createElement("textarea");
    term.appendChild(ta);
    document.body.appendChild(term);
    act(() => {
      fireEvent.keyDown(ta, { key: "n", metaKey: true });
      fireEvent.keyDown(ta, { key: "k", metaKey: true });
    });
    expect(screen.getByTestId("where").textContent).toBe("home/none");
    // Collapsed search (jsdom is narrower than 1240): ⌘K would expand it.
    expect(screen.queryByRole("combobox")).toBeNull();
    term.remove();
    act(() => {
      fireEvent.keyDown(window, { key: "k", metaKey: true });
    });
    expect(screen.getByRole("combobox")).toBeTruthy();
  });
});
