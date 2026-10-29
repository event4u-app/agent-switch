import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { emptyViewModel } from "../../vm/load.js";
import { ASProvider } from "../../vm/store.js";
import { useStartupEngines } from "./startup.js";

const h = vi.hoisted(() => ({ activated: 0 }));
vi.mock("../../ipc.js", async (orig) => ({
  ...(await orig<typeof import("../../ipc.js")>()),
  activateCli: async () => {
    h.activated++;
    return { cli: "/x/dist/index.js", service: "unchanged" };
  },
  setMinimizeToDock: async () => {},
  shareStatus: async () => ({ active: false, profiles: [] }),
}));

function Host() {
  useStartupEngines();
  return null;
}

afterEach(cleanup);

describe("startup", () => {
  it("makes this window's CLI the one terminals and the service use, once per start", async () => {
    const { rerender } = render(
      <ASProvider initial={emptyViewModel(0)}>
        <Host />
      </ASProvider>,
    );
    rerender(
      <ASProvider initial={emptyViewModel(0)}>
        <Host />
      </ASProvider>,
    );
    await waitFor(() => expect(h.activated).toBe(1));
  });
});
