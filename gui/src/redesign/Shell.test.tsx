import { afterEach, describe, it, expect } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AcRoot } from "../ui/AcRoot.js";
import { accountFromProfile } from "../vm/build.js";
import { emptyViewModel } from "../vm/load.js";
import { ASProvider, useAS } from "../vm/store.js";
import { CommandSearch } from "./CommandSearch.js";
import { Shell } from "./Shell.js";

function ScreenName() {
  const s = useAS();
  return <p data-testid="where">{`${s.screen}/${s.overlay.kind}`}</p>;
}

function renderShell() {
  const vm = {
    ...emptyViewModel(),
    accounts: [
      accountFromProfile({ provider: "claude", name: "work", identity: null, label: null, active: true, liveSessions: 0 }, null),
    ],
    readiness: "ready" as const,
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
});
