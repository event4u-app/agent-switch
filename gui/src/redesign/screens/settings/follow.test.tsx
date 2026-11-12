import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { setLangForTests } from "../../../i18n/index.js";
import { AcRoot } from "../../../ui/AcRoot.js";
import { emptyViewModel } from "../../../vm/load.js";
import { ASProvider } from "../../../vm/store.js";

const ipcMock = vi.hoisted(() => ({
  followStatus: vi.fn(),
  followSyncNow: vi.fn(async () => ({ ran: true, confirmNew: false, targets: [] })),
  setFollowConfirm: vi.fn(async () => {}),
  followApprove: vi.fn(async () => {}),
}));
vi.mock("../../../ipc.js", async (orig) => ({ ...(await orig<typeof import("../../../ipc.js")>()), ...ipcMock }));

import { FollowCard } from "./follow.js";

beforeEach(() => {
  setLangForTests("en");
  ipcMock.followStatus.mockRejectedValue(new Error("no CLI"));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Settings › Updates › every account follows its source", () => {
  const follow = (over: Partial<import("../../../ipc.js").FollowStatus> = {}) => ({
    ran: true,
    confirmNew: false,
    targets: [
      { key: "claude/work", source: "default", state: "applied" as const, detail: "in step" },
      { key: "claude-desktop/work", source: "default", state: "pending-app-running" as const, detail: "Claude Desktop is open on this profile" },
    ],
    ...over,
  });
  const mountCard = () =>
    render(
      <AcRoot>
        <ASProvider initial={emptyViewModel()} actions={() => ({})}>
          <FollowCard />
        </ASProvider>
      </AcRoot>,
    );

  it("applies automatically by default and names an account that waits for its app", async () => {
    ipcMock.followStatus.mockResolvedValue(follow());
    mountCard();
    const sw = await screen.findByRole("switch", { name: "Ask before new plugins and extensions" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText("1 account not up to date")).toBeTruthy();
    expect(screen.getByText(/Claude Desktop is open on this profile/)).toBeTruthy();
  });

  it("the switch turns the confirmation on and reloads", async () => {
    ipcMock.followStatus.mockResolvedValueOnce(follow()).mockResolvedValue(follow({ confirmNew: true }));
    mountCard();
    fireEvent.click(await screen.findByRole("switch", { name: "Ask before new plugins and extensions" }));
    await waitFor(() => expect(ipcMock.setFollowConfirm).toHaveBeenCalledWith(true));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Ask before new plugins and extensions" }).getAttribute("aria-checked")).toBe("true"));
  });

  it("what waits for approval can be approved", async () => {
    ipcMock.followStatus.mockResolvedValue(follow({ confirmNew: true, targets: [{ key: "claude/work", source: "default", state: "pending-approval", detail: "waiting for approval: plugin:x@m" }] }));
    mountCard();
    fireEvent.click(await screen.findByRole("button", { name: /Approve/ }));
    await waitFor(() => expect(ipcMock.followApprove).toHaveBeenCalled());
  });

  it("shows nothing when the CLI cannot report", async () => {
    mountCard();
    await waitFor(() => expect(ipcMock.followStatus).toHaveBeenCalled());
    expect(screen.queryByRole("switch", { name: "Ask before new plugins and extensions" })).toBeNull();
  });
});
