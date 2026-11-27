/**
 * Claude Design embed: `ASv3.mount(el, { view, theme, accent })` renders one
 * board of the canvas from the real v3 window on fixture data (scene.tsx).
 * A board that shows a state (a popover, a page, a dialog) reaches it the way a
 * user does — clicks, keys, hover — so the canvas never drifts from the app.
 * Built as one IIFE by vite.v3embed.config.ts; embed.html runs it in dev.
 */
import { createRoot, type Root } from "react-dom/client";
import type { Accent } from "../themes/resolve.js";
import { Scene, type SceneOptions } from "./scene.js";

export type Step =
  | { click: string; nth?: number; exact?: boolean }
  /** `hold`: no keyup, for a key that acts on release (⌃Tab commits when ⌃ lets go). */
  | { key: string; mod?: boolean; ctrl?: boolean; shift?: boolean; hold?: boolean }
  | { hover: string }
  | { wait: number };

interface Board {
  scene?: Omit<SceneOptions, "theme" | "accent">;
  steps?: Step[];
}

const SETTINGS: Step[] = [{ click: "Settings" }];

/** Board name → scene + the steps that reach its state. Names are the canvas's `view` values. */
export const BOARDS: Record<string, Board> = {
  main: {},
  summary: { steps: [{ click: "Summary" }] },
  peek: { steps: [{ hover: "Release plan" }, { wait: 700 }] },
  limits: { steps: [{ click: "side" }] },
  comfortable: { scene: { layout: { comfortable: true } } },
  compact: { scene: { layout: { comfortable: false } } },
  morning: { scene: { away: true } },
  needs: { steps: [{ key: "j", mod: true }] },
  inbox: { steps: [{ key: "b", mod: true }, { click: "6" }] },
  group: { steps: [{ click: "Status" }] },
  switcher: { steps: [{ click: "v3 engine" }, { click: "Release plan" }, { click: "Fix wedge" }, { key: "Tab", ctrl: true, hold: true }] },
  palette: { steps: [{ key: "k", mod: true }] },
  openin: { steps: [{ click: "Open in" }] },
  model: { steps: [{ click: "Opus 5.5" }] },
  conflict: { steps: [{ click: "Checkout flow accessibility" }] },
  external: { steps: [{ click: "as-hook p95" }] },
  externalchat: { steps: [{ click: "as-hook p95" }, { click: "Chat" }] },
  tree: { steps: [{ click: "Show 3 subagents" }] },
  subagent: { steps: [{ click: "Show 3 subagents" }, { click: "general-purpose · migrate JSON stores" }] },
  // The board of a session that runs an arena: the tournament, its council, its workflow runs.
  arena: { steps: [{ click: "Show 2 runs" }, { click: "Arena · tcc-signing" }, { wait: 300 }] },
  // The same arena won: the champion's card and the header shine.
  "arena-win": { scene: { board: "won" }, steps: [{ click: "Show 2 runs" }, { click: "Arena · tcc-signing" }, { wait: 300 }] },
  "arena-match": { steps: [{ click: "Show 2 runs" }, { click: "Arena · tcc-signing" }, { wait: 300 }, { click: "R3M1" }] },
  "arena-line": { steps: [{ click: "Show 2 runs" }, { click: "Arena · tcc-signing" }, { wait: 300 }, { click: "L005" }] },
  council: { steps: [{ click: "Show 2 runs" }, { click: "Arena · tcc-signing" }, { wait: 300 }, { click: "Council · 20261124T1300Z-tcc" }] },
  "council-live": { steps: [{ click: "Show 2 runs" }, { click: "Arena · tcc-signing" }, { wait: 300 }, { click: "Council · 20261124T1735Z-board" }] },
  workflows: { steps: [{ click: "Show 2 runs" }, { click: "Arena · tcc-signing" }, { wait: 300 }, { click: "Workflows (3)" }] },
  batch: { steps: [{ click: "Select · density" }, { click: "Select", exact: true }, { click: "v3 engine" }, { click: "Release plan" }] },
  focus: { steps: [{ key: "b", mod: true }] },
  offline: { scene: { health: "down" } },
  firstrun: { scene: { view: "firstrun" } },
  new: { steps: [{ click: "New session" }] },
  decide: { steps: [{ click: "Decide" }] },
  end: { steps: [{ click: "Session actions" }, { click: "End…" }] },
  accounts: { steps: [{ click: "Accounts" }] },
  table: { steps: [{ key: "k", mod: true }, { click: "All sessions" }] },
  /** The Changes window after PhpStorm's (owner, 2026-11-27); "changes-local": a folder without git (the spike). */
  changes: { steps: [{ click: "Changes" }] },
  "changes-local": { steps: [{ key: "k", mod: true }, { click: "All sessions" }, { wait: 300 }, { click: "Spike: tmux control mode" }, { wait: 300 }, { click: "Changes" }] },
  library: { steps: [{ click: "Library" }] },
  // The resume preflight lives outside V3Window (act → app); this board shows where it starts.
  resume: { steps: [{ click: "Library" }] },
  tools: { steps: [{ click: "Tools" }] },
  // The bottom of the left stripe: what runs across sessions, by kind.
  arenas: { steps: [{ click: "Arenas" }] },
  councils: { steps: [{ click: "Councils" }] },
  panels: { steps: [{ click: "Panels" }] },
  tray: { scene: { view: "tray" } },
  "tray-codex": { scene: { view: "tray-codex" }, steps: [{ click: "Codex" }] },
  appearance: { steps: [...SETTINGS, { click: "Appearance" }] },
  gallery: { steps: [...SETTINGS, { click: "Appearance" }] },
  editors: { steps: [...SETTINGS, { click: "Open in" }] },
  agents: { steps: [...SETTINGS, { click: "Agents" }] },
  remote: { steps: [...SETTINGS, { click: "Remote" }] },
  chat: { scene: { chat: true } },
  review: { steps: [{ click: "v3 engine" }, { click: "Changes" }, { click: "Review src/engine/ingest.ts" }] },
  markdown: { scene: { view: "markdown" } },
  hints: { scene: { view: "hints" } },
};

const CLICKABLE = 'button, [role="button"], a[href], [role="tab"], [role="radio"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="option"], [role="switch"], [role="checkbox"], [data-session-row]';

const nameOf = (e: Element) => (e.getAttribute("aria-label") ?? e.textContent ?? "").replace(/\s+/g, " ").trim();

/** The nth visible control whose accessible name starts with `name` (then: contains it), in the board or a portal. */
function find(scope: Element, name: string, nth = 0, exact = false): HTMLElement | null {
  const all = [...scope.querySelectorAll(CLICKABLE), ...document.body.querySelectorAll(`body > :not(#${CSS.escape(scope.id || "_")}) ${CLICKABLE}`)]
    .filter((e, i, a) => a.indexOf(e) === i)
    .filter((e) => (e as HTMLElement).offsetParent !== null || e.getClientRects().length > 0) as HTMLElement[];
  if (exact) return all.filter((e) => nameOf(e) === name)[nth] ?? null;
  const starts = all.filter((e) => nameOf(e).startsWith(name));
  const hits = starts.length ? starts : all.filter((e) => nameOf(e).includes(name));
  return hits[nth] ?? null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function run(scope: Element, steps: Step[], alive: () => boolean) {
  for (const s of steps) {
    await sleep(160);
    if (!alive()) return;
    if ("wait" in s) await sleep(s.wait);
    else if ("key" in s) {
      const ev = { key: s.key, code: s.key.length === 1 ? `Key${s.key.toUpperCase()}` : s.key, metaKey: !!s.mod, ctrlKey: !!s.ctrl, shiftKey: !!s.shift, bubbles: true, cancelable: true };
      // A focused terminal keeps its keys; the shortcuts are the window's.
      (document.activeElement as HTMLElement | null)?.blur?.();
      window.dispatchEvent(new KeyboardEvent("keydown", ev));
      if (!s.hold) window.dispatchEvent(new KeyboardEvent("keyup", { ...ev, metaKey: false, ctrlKey: false }));
    } else {
      const el = "click" in s ? find(scope, s.click, s.nth, s.exact) : find(scope, s.hover);
      if (!el) {
        console.warn("[ASv3] no control named", s);
        continue;
      }
      if ("click" in s) el.click();
      else {
        el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: document.body }));
        el.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }));
        el.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
        el.dispatchEvent(new PointerEvent("pointerenter", { bubbles: false }));
      }
    }
  }
}

export interface MountOptions {
  view?: string;
  theme?: string;
  accent?: Accent;
}

/** One root per element; `run` is the current mount, so a remount stops the old playback and an old cleanup is a no-op. */
const mounts = new WeakMap<Element, { root: Root; run: number }>();
let runs = 0;

export function mount(el: Element, o: MountOptions = {}): () => void {
  const board = BOARDS[o.view ?? "main"] ?? BOARDS.main;
  const m = mounts.get(el) ?? { root: createRoot(el), run: 0 };
  const id = (m.run = ++runs);
  mounts.set(el, m);
  const alive = () => mounts.get(el)?.run === id;
  // A new key remounts the scene, so the previous board's clicked state never carries over.
  m.root.render(<Scene key={id} view="main" {...board.scene} theme={o.theme ?? "darcula"} accent={o.accent ?? "theme"} platform="mac" />);
  // Sessions arrive on the first effect; steps start once the window has painted.
  if (board.steps?.length) void sleep(350).then(() => run(el, board.steps!, alive));
  return () => {
    if (!alive()) return;
    m.root.unmount();
    mounts.delete(el);
  };
}

export const views = Object.keys(BOARDS);
