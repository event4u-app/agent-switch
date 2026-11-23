import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { AcRoot } from "./ui/AcRoot.js";
import { accountFromProfile } from "./vm/build.js";
import { emptyViewModel } from "./vm/load.js";
import { ASProvider, type Screen } from "./vm/store.js";
import type { ViewModel } from "./vm/types.js";
import { ScreenHost } from "./redesign/Hosts.js";
import { Shell } from "./redesign/Shell.js";
import { Tray } from "./redesign/tray/Tray.js";
import { V3Window } from "./v3/window.js";
import { V3Tray } from "./v3/tray.js";
import { data, limit, slots } from "./v3/window-fixture.js";
import { installMemoryStorage } from "./redesign/engines/test-storage.js";

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    rows = 24;
    cols = 80;
    loadAddon() {}
    open() {}
    focus() {}
    onData() {}
    write() {}
    dispose() {}
  },
}));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() {} } }));
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    disconnect() {}
  },
);
installMemoryStorage();
afterEach(cleanup);

/** Rules that need a laid-out page, which jsdom does not have: contrast reads
 *  computed colours over painted backgrounds. They stay a design-review item. */
const LAYOUT_RULES = { "color-contrast": { enabled: false } };
// axe probes canvas for icon fonts; jsdom has none and logs on every call.
HTMLCanvasElement.prototype.getContext = () => null;

/** A known finding, kept out of the result until the change that fixes it. */
interface Known {
  rule: string;
  html: RegExp;
}

/** The v3 tab strip puts each tab's close button inside the tablist; giving it
 *  real ARIA tabs (focusable tabs, a key to close) is its own change. */
const V3_TAB_CLOSE: Known[] = [{ rule: "nested-interactive", html: /^<div role="tab"/ }];

async function violations(root: Element, known: Known[] = []): Promise<string[]> {
  const r = await axe.run(root, { rules: LAYOUT_RULES, resultTypes: ["violations"] });
  return r.violations.flatMap((v) => {
    const nodes = v.nodes.filter((n) => !known.some((k) => k.rule === v.id && k.html.test(n.html)));
    return nodes.length ? [`${v.id}: ${nodes.map((n) => n.html.slice(0, 160)).join(" | ")}`] : [];
  });
}

/** Each known finding still occurs; when one no longer does, it is fixed and goes. */
async function stillKnown(root: Element, known: Known[]): Promise<string[]> {
  const r = await axe.run(root, { rules: LAYOUT_RULES, resultTypes: ["violations"] });
  return known.filter((k) => !r.violations.some((v) => v.id === k.rule && v.nodes.some((n) => k.html.test(n.html)))).map((k) => k.rule);
}

function vm(): ViewModel {
  const work = accountFromProfile({ provider: "claude", name: "work", identity: "work@example.test", label: null, active: true, liveSessions: 1 }, null);
  const side = accountFromProfile({ provider: "codex", name: "side", identity: null, label: null, active: false, liveSessions: 0 }, null);
  return {
    ...emptyViewModel(1_800_000_000_000),
    accounts: [work, side],
    checks: [
      { id: "a", title: "Shell integration", detail: "installed", state: "ok" },
      { id: "b", title: "Session hooks", detail: "missing", state: "warn" },
    ],
    readiness: "ready",
  };
}

function redesign(screen: Screen) {
  return render(
    <AcRoot>
      <ASProvider initial={vm()} startScreen={screen}>
        <Shell isMac>
          <ScreenHost />
        </Shell>
      </ASProvider>
    </AcRoot>,
  );
}

describe("axe finds no violations in the main views", () => {
  for (const screen of ["home", "sessions", "accounts", "tools", "health", "activity", "settings"] as const) {
    it(`redesign window: ${screen}`, async () => {
      const { container } = redesign(screen);
      expect(await violations(container)).toEqual([]);
    });
  }

  it("redesign tray", async () => {
    const { container } = render(
      <AcRoot>
        <ASProvider initial={vm()}>
          <Tray onOpenApp={() => {}} onQuit={() => {}} onGo={() => {}} onOpenAccountApp={() => {}} />
        </ASProvider>
      </AcRoot>,
    );
    expect(await violations(container)).toEqual([]);
  });

  it("v3 window", async () => {
    const { container } = render(<V3Window data={data()} slots={slots} act={() => {}} />);
    expect(await violations(container, V3_TAB_CLOSE)).toEqual([]);
    expect(await stillKnown(container, V3_TAB_CLOSE)).toEqual([]);
  });

  it("v3 tray", async () => {
    const d = data();
    const on = { verb() {}, moreNeeds() {}, away() {}, session() {}, moreSessions() {}, account() {}, signIn() {}, start() {}, open() {} };
    const { container } = render(<V3Tray nowMs={d.nowMs} ready needs={d.needs} away={null} sessions={d.sessions} accounts={[limit]} on={on} />);
    expect(await violations(container)).toEqual([]);
  });

  it("is sensitive: an unnamed button is reported", async () => {
    const { container } = render(<button type="button" />);
    expect(await violations(container)).toEqual([expect.stringMatching(/^button-name: /)]);
  });
});
