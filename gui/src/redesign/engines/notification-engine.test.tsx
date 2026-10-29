import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { AppNotification } from "../../notifications.js";
import { AcRoot } from "../../ui/AcRoot.js";
import { Toaster } from "../../ui/Toaster.js";
import { emptyViewModel } from "../../vm/load.js";
import { ASProvider, useAS } from "../../vm/store.js";
import { notify } from "./bus.js";
import { useNotificationEngine } from "./notifications.js";
import { installMemoryStorage } from "./test-storage.js";

const h = vi.hoisted(() => ({
  log: [] as AppNotification[],
  recorded: [] as string[],
  desktop: [] as string[],
  desktopOk: false,
  click: null as null | (() => void),
}));

vi.mock("../../ipc.js", async (orig) => ({
  ...(await orig<typeof import("../../ipc.js")>()),
  listNotifications: async () => h.log,
  recordNotification: async (kind: AppNotification["kind"], title: string, message: string) => {
    h.recorded.push(title);
    h.log = [{ id: `r${h.log.length}`, ts: Date.now() + 1, kind, title, message }, ...h.log];
  },
  getOsNotify: async () => true,
  installSessionHooks: async () => {},
  petDeliver: async () => {},
}));
vi.mock("../../notifications.js", async (orig) => ({
  ...(await orig<typeof import("../../notifications.js")>()),
  sendDesktopNotification: async (title: string) => {
    h.desktop.push(title);
    return h.desktopOk;
  },
  onNotificationClick: async (cb: () => void) => {
    h.click = cb;
    return () => {};
  },
  showAppWindow: async () => {},
}));

function Probe() {
  useNotificationEngine();
  const s = useAS();
  return (
    <>
      <p data-testid="where">{s.overlay.kind}</p>
      <p data-testid="notices">{s.notices.map((n) => n.title).join(",")}</p>
      <Toaster toasts={s.toasts} onDismiss={s.dismissToast} />
    </>
  );
}

function mount() {
  return render(
    <AcRoot>
      <ASProvider initial={emptyViewModel()}>
        <Probe />
      </ASProvider>
    </AcRoot>,
  );
}

beforeEach(() => {
  installMemoryStorage();
  h.log = [];
  h.recorded = [];
  h.desktop = [];
  h.desktopOk = false;
  h.click = null;
});
afterEach(cleanup);

describe("notification engine", () => {
  it("never re-delivers history, but delivers what is recorded while open (desktop, then toast fallback)", async () => {
    h.log = [{ id: "old", ts: 1, kind: "warning", title: "Old event", message: "" }];
    localStorage.setItem("agent-switch-muted-notif-kinds", "[]"); // default mutes warnings
    mount();
    await waitFor(() => expect(screen.getByTestId("notices").textContent).toBe("Old event"));
    expect(h.desktop).toEqual([]);
    await act(() => notify("warning", "Usage limit near", "claude/work hit ≥90%"));
    await waitFor(() => expect(h.desktop).toEqual(["Usage limit near"]));
    expect(await screen.findByText(/Usage limit near — claude\/work hit/)).toBeTruthy();
  });

  it("keeps muted kinds out of the sheet and the badge", async () => {
    localStorage.setItem("agent-switch-muted-notif-kinds", JSON.stringify(["info"]));
    h.log = [
      { id: "a", ts: 1, kind: "info", title: "Muted", message: "" },
      { id: "b", ts: 2, kind: "error", title: "Shown", message: "" },
    ];
    mount();
    await waitFor(() => expect(screen.getByTestId("notices").textContent).toBe("Shown"));
  });

  it("a clicked desktop notification opens the notifications sheet", async () => {
    mount();
    await waitFor(() => expect(h.click).not.toBeNull());
    act(() => h.click!());
    expect(screen.getByTestId("where").textContent).toBe("notifications");
  });
});
