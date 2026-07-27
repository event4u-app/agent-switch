/**
 * Pet window entry (road-to-desktop-pet Phases 1–4). Renders one pet-pack
 * spritesheet (contract: gui/public/pets/README.md) and reacts to events the
 * main window emits from its notification fan-out:
 *
 *   "pet-notification" { kind, title, action }  → transient reaction + bubble
 *   "pet-context"      { pct }                  → ambient mood dot
 *
 * Settings arrive via shared localStorage (same origin as the main window) and
 * apply live through the cross-window `storage` event. Actionable bubbles
 * (switch suggestion, update available) only NAVIGATE to the matching surface
 * in the main window — the pet itself never switches or installs anything.
 */

import { invoke } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  LogicalSize,
  PhysicalPosition,
  PhysicalSize,
  availableMonitors,
  currentMonitor,
  getCurrentWindow,
} from "@tauri-apps/api/window";
import type { NotificationKind } from "./notifications.js";
import {
  BUBBLE_DURATION_MS,
  BUBBLE_HINT,
  FRAME_H,
  FRAME_W,
  KIND_TO_REACTION,
  PET_SIZE_FACTOR,
  REACTION_COOLDOWN_MS,
  ROWS,
  TRANSIENT_LOOPS,
  contextMood,
  sanitizeBubble,
  type BubbleAction,
  type Reaction,
} from "./pet/model.js";

const SHEET_COLS = 8;
const SHEET_ROWS = 9;
import {
  getDevMode,
  getPetBubbleDuration,
  getPetBubbles,
  getPetChoice,
  getPetLabel,
  getPetMotion,
  getPetPos,
  getPetPosLock,
  getPetPresence,
  getPetSize,
  clearPetPos,
  setPetPos,
  setPetPrevPos,
} from "./settings-store.js";

const sprite = document.getElementById("sprite") as HTMLDivElement;
const bubble = document.getElementById("bubble") as HTMLDivElement;
const mood = document.getElementById("mood") as HTMLDivElement;
const label = document.getElementById("label") as HTMLDivElement;

let currentReaction: Reaction = "idle";
let transientTimer: ReturnType<typeof setTimeout> | null = null;
let bubbleTimer: ReturnType<typeof setTimeout> | null = null;
let lastReactionAt = 0;

function animationsOn(): boolean {
  const motion = getPetMotion();
  if (motion === "off") return false;
  if (motion === "on") return true;
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Paint `reaction` — animated when motion allows, else its first frame. All
 *  pixel offsets scale with the size setting (the sheet is downscaled via
 *  background-size, so frame geometry scales with it). */
function paint(reaction: Reaction, loops: number | "infinite") {
  const f = PET_SIZE_FACTOR[getPetSize()];
  const r = ROWS[reaction];
  sprite.style.backgroundImage = `url(./pets/${getPetChoice()}/spritesheet.webp)`;
  sprite.style.setProperty("--row-y", `${-r.row * FRAME_H * f}px`);
  sprite.style.setProperty("--end-x", `${-r.frames * FRAME_W * f}px`);
  sprite.style.animation = "none";
  void sprite.offsetWidth; // restart the keyframes from frame 0
  sprite.style.animation = animationsOn()
    ? `pet-frames ${r.durationMs}ms steps(${r.frames}) ${loops === "infinite" ? "infinite" : loops}`
    : "none";
  label.textContent = `${getPetChoice()} · ${reaction}`;
}

function idle() {
  currentReaction = "idle";
  paint("idle", "infinite");
}

/* Presence "message-only" (default): the pet appears around a notification
 * and hides again once the bubble is gone and the reaction has settled. Never
 * scheduled at boot — only after real activity — so "always" and manual shows
 * are untouched. */
let dismissTimer: ReturnType<typeof setTimeout> | null = null;

function cancelDismiss() {
  if (dismissTimer) clearTimeout(dismissTimer);
  dismissTimer = null;
}

function scheduleDismiss() {
  if (getPetPresence() !== "message-only") return;
  cancelDismiss();
  dismissTimer = setTimeout(() => {
    dismissTimer = null;
    if (bubble.classList.contains("show")) return; // still talking
    void invoke("pet_hide").catch(() => {});
  }, 2000);
}

/** Play a transient reaction, then fall back to idle. */
function react(reaction: Reaction) {
  if (transientTimer) clearTimeout(transientTimer);
  currentReaction = reaction;
  paint(reaction, TRANSIENT_LOOPS);
  transientTimer = setTimeout(() => {
    idle();
    scheduleDismiss();
  }, ROWS[reaction].durationMs * TRANSIENT_LOOPS);
}

function hideBubble() {
  bubble.classList.remove("show", "actionable");
  bubble.onclick = null;
  void layoutWindow(); // shrink back to the base height
  scheduleDismiss();
}

function showBubble(kind: NotificationKind, text: string, action: BubbleAction | null) {
  if (!getPetBubbles()) return;
  if (bubbleTimer) clearTimeout(bubbleTimer);
  bubble.textContent = sanitizeBubble(text);
  bubble.dataset.kind = kind; // per-kind color accent on the alignment edge
  bubble.classList.add("show");
  bubble.classList.toggle("actionable", action != null);
  bubble.dataset.hint = action ? ` → ${BUBBLE_HINT[action]}` : "";
  bubble.onclick = action
    ? () => {
        hideBubble();
        // Navigation only: bring the main window up and let IT own the
        // action's surface (confirm dialog / Updates tab / Tooling) — the
        // pet never executes a switch or an install itself.
        void invoke("show_window").catch(() => {});
        void emitTo({ kind: "WebviewWindow", label: "main" }, "pet-action", { action }).catch(() => {});
      }
    : null;
  // Measure AFTER the browser laid the (possibly multi-line) text out, then
  // grow the window to fit — a fixed bubble zone clips long texts.
  requestAnimationFrame(() => void layoutWindow());
  // An actionable bubble gets at least the long TTL — it carries a decision.
  const ttl = Math.max(BUBBLE_DURATION_MS[getPetBubbleDuration()], action ? BUBBLE_DURATION_MS.long : 0);
  bubbleTimer = setTimeout(hideBubble, ttl);
}

/** Dev-only state label — production builds never show it, dev builds only
 *  with dev mode AND the (default-off) label toggle on. */
function labelVisible(): boolean {
  return import.meta.env.DEV && getDevMode() && getPetLabel();
}

/** Window bounds follow the content: base (sprite + paddings + dev label)
 *  plus the MEASURED bubble height when one is visible — long bubble texts
 *  wrap and must never be clipped by a fixed zone. Growth respects the
 *  quadrant anchor read from the body classes: v-bottom grows UPWARD (bottom
 *  edge pinned, the sprite stays put), v-top grows downward; h-right keeps
 *  the right edge pinned. */
async function layoutWindow() {
  const f = PET_SIZE_FACTOR[getPetSize()];
  const bubbleH = bubble.classList.contains("show") ? bubble.offsetHeight + 4 /* gap */ : 0;
  const logicalW = Math.max(FRAME_W * f + 48, 220); // bubble stays readable
  const logicalH = 8 + bubbleH + FRAME_H * f + 12 + (labelVisible() ? 22 : 0);
  const win = getCurrentWindow();
  try {
    const [pos, size, scale] = await Promise.all([win.outerPosition(), win.outerSize(), win.scaleFactor()]);
    const newW = Math.round(logicalW * scale);
    const newH = Math.round(logicalH * scale);
    if (newW === size.width && newH === size.height) return;
    const x = document.body.classList.contains("h-right") ? pos.x + size.width - newW : pos.x;
    const y = document.body.classList.contains("v-bottom") ? pos.y + size.height - newH : pos.y;
    await win.setSize(new PhysicalSize(newW, newH));
    if (x !== pos.x || y !== pos.y) await win.setPosition(new PhysicalPosition(x, y));
  } catch {
    // Metrics unavailable (tests / degraded env) → plain resize, no re-anchor.
    void win.setSize(new LogicalSize(logicalW, logicalH)).catch(() => {});
  }
}

async function applySize() {
  const f = PET_SIZE_FACTOR[getPetSize()];
  sprite.style.width = `${FRAME_W * f}px`;
  sprite.style.height = `${FRAME_H * f}px`;
  sprite.style.backgroundSize = `${FRAME_W * SHEET_COLS * f}px ${FRAME_H * SHEET_ROWS * f}px`;
  label.style.display = labelVisible() ? "" : "none";
  await layoutWindow();
}

/** Quadrant classes on <body>: the whole content column (bubble, sprite,
 *  label) aligns to the screen edge the pet sits nearest — right half →
 *  right-aligned, bottom half → bubble above the sprite, top half → below.
 *
 *  Judged by the SPRITE center (not the window center): when the alignment
 *  flips, the window shifts to keep the sprite visually fixed, and a sprite-
 *  based measure is invariant under that shift — no flip oscillation. */
let prevQuadrant: { right: boolean; bottom: boolean } | null = null;

async function updateQuadrant() {
  if (drag) return; // never fight an active manual drag; runs again on release
  try {
    const win = getCurrentWindow();
    const [pos, size, monitor, scale] = await Promise.all([
      win.outerPosition(),
      win.outerSize(),
      currentMonitor(),
      win.scaleFactor(),
    ]);
    if (!monitor) return;
    const rect = sprite.getBoundingClientRect();
    const spriteCx = pos.x + (rect.x + rect.width / 2) * scale;
    const spriteCy = pos.y + (rect.y + rect.height / 2) * scale;
    const right = spriteCx >= monitor.position.x + monitor.size.width / 2;
    const bottom = spriteCy >= monitor.position.y + monitor.size.height / 2;
    document.body.classList.toggle("h-right", right);
    document.body.classList.toggle("h-left", !right);
    document.body.classList.toggle("v-bottom", bottom);
    document.body.classList.toggle("v-top", !bottom);
    // Alignment flip moves the content column INSIDE the window — shift the
    // window by the leftover slack so the sprite stays where the user sees it.
    if (prevQuadrant && (prevQuadrant.right !== right || prevQuadrant.bottom !== bottom)) {
      const f = PET_SIZE_FACTOR[getPetSize()];
      const slackX = Math.round(size.width - (FRAME_W * f + 12) * scale);
      const slackY = Math.round(size.height - (FRAME_H * f + 12 + (labelVisible() ? 22 : 0)) * scale);
      let dx = 0;
      let dy = 0;
      if (prevQuadrant.right !== right) dx = right ? -slackX : slackX;
      if (prevQuadrant.bottom !== bottom) dy = bottom ? -slackY : slackY;
      if (dx || dy) await win.setPosition(new PhysicalPosition(pos.x + dx, pos.y + dy));
    }
    prevQuadrant = { right, bottom };
  } catch {
    /* keep the previous alignment */
  }
}

/* ---- events from the main window ---- */

interface PetNotification {
  kind: NotificationKind;
  title: string;
  /** Navigation target of a clickable bubble, or null for a plain one. */
  action: BubbleAction | null;
  /** Dev bubble test: skip the reaction cooldown. */
  force?: boolean;
}

// All listeners are scoped to THIS webview window — the main side addresses
// the exact WebviewWindow target, so the pairing is unambiguous.
const petWindow = getCurrentWebviewWindow();

void petWindow.listen<PetNotification>("pet-notification", (e) => {
  const now = Date.now();
  if (!e.payload.force && now - lastReactionAt < REACTION_COOLDOWN_MS) return;
  lastReactionAt = now;
  cancelDismiss(); // fresh activity keeps a message-only pet on screen
  react(KIND_TO_REACTION[e.payload.kind] ?? "waving");
  showBubble(e.payload.kind, e.payload.title, e.payload.action ?? null);
}).catch(() => {});

void petWindow.listen<{ pct: number | null }>("pet-context", (e) => {
  const m = contextMood(e.payload.pct);
  mood.className = m ?? "";
}).catch(() => {});

// "Reset to last position": the main window sends an absolute target.
void petWindow
  .listen<{ x: number; y: number }>("pet-move", (e) => {
    void getCurrentWindow()
      .setPosition(new PhysicalPosition(e.payload.x, e.payload.y))
      .then(() => updateQuadrant())
      .catch(() => {});
  })
  .catch(() => {});

// Dev-mode pose picker (Pet section): hold the selected row until the next
// pick so it can be inspected — a QA tool, so it bypasses the cooldown and
// the transient return-to-idle. Picking "idle" restores normal behavior.
void petWindow.listen<{ reaction: string }>("pet-pose", (e) => {
  const reaction = e.payload.reaction as Reaction;
  if (!(reaction in ROWS)) return;
  if (transientTimer) clearTimeout(transientTimer);
  currentReaction = reaction;
  paint(reaction, "infinite");
}).catch(() => {});

/* ---- direct interaction: click = wave, hold/move = manual drag ---- */

// The drag is implemented manually (setPosition from mousemove deltas — the
// openpets approach) instead of the native startDragging(): a native OS drag
// swallows all input until mouse-up, so ESC-to-cancel would be impossible.
// Manual dragging keeps the webview in the loop: ESC while the button is
// still down snaps back to the start position and cancels the move; once the
// button is released, `drag` is null and ESC does nothing.

const HOLD_TO_DRAG_MS = 150;
const DRAG_THRESHOLD_PX = 3;

interface DragState {
  startScreenX: number;
  startScreenY: number;
  anchor: { x: number; y: number } | null; // window pos at press (filled async)
  scale: number;
  dragging: boolean;
  cancelled: boolean;
  holdTimer: ReturnType<typeof setTimeout> | null;
}
let drag: DragState | null = null;
let pendingMove: PhysicalPosition | null = null;
let rafPending = false;

sprite.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  const locked = getPetPosLock();
  const state: DragState = {
    startScreenX: e.screenX,
    startScreenY: e.screenY,
    anchor: null,
    scale: 1,
    dragging: false,
    cancelled: false,
    // Position lock: never arm the drag — a quick click still waves.
    holdTimer: locked
      ? null
      : setTimeout(() => {
          if (drag === state) state.dragging = true;
        }, HOLD_TO_DRAG_MS),
  };
  drag = state;
  const win = getCurrentWindow();
  void Promise.all([win.outerPosition(), win.scaleFactor()])
    .then(([pos, scale]) => {
      if (drag !== state) return;
      state.anchor = { x: pos.x, y: pos.y };
      state.scale = scale;
    })
    .catch(() => {});
});

window.addEventListener("mousemove", (e) => {
  if (!drag || drag.cancelled || !drag.anchor || !(e.buttons & 1)) return;
  if (getPetPosLock()) return; // locked: ignore movement entirely
  const dx = e.screenX - drag.startScreenX;
  const dy = e.screenY - drag.startScreenY;
  if (!drag.dragging && Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) drag.dragging = true;
  if (!drag.dragging) return;
  pendingMove = new PhysicalPosition(
    drag.anchor.x + Math.round(dx * drag.scale),
    drag.anchor.y + Math.round(dy * drag.scale),
  );
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    const target = pendingMove;
    pendingMove = null;
    if (target && drag && drag.dragging && !drag.cancelled) {
      void getCurrentWindow()
        .setPosition(target)
        .catch(() => {});
    }
  });
});

window.addEventListener("mouseup", (e) => {
  if (e.button !== 0 || !drag) return;
  if (drag.holdTimer) clearTimeout(drag.holdTimer);
  const wasClick = !drag.dragging && !drag.cancelled;
  // A completed (uncancelled) move records where it started — the one-step
  // history behind "Reset to last position".
  if (drag.dragging && !drag.cancelled && drag.anchor) setPetPrevPos(drag.anchor);
  drag = null;
  if (wasClick && currentReaction === "idle") react("waving");
  void updateQuadrant(); // alignment updates only after the drag settles
});

// ESC cancels ONLY an in-flight move (button still down): snap back to the
// press position and ignore further movement until release.
window.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !drag || !drag.dragging || !drag.anchor) return;
  drag.cancelled = true;
  drag.dragging = false;
  void getCurrentWindow()
    .setPosition(new PhysicalPosition(drag.anchor.x, drag.anchor.y))
    .catch(() => {});
});

// No context menu on the overlay — pet choice lives in the Pet section only.
document.addEventListener("contextmenu", (e) => e.preventDefault());

/* ---- settings apply live (cross-window storage event) ---- */

window.addEventListener("storage", () => {
  void applySize();
  paint(currentReaction, currentReaction === "idle" ? "infinite" : TRANSIENT_LOOPS);
});

/* ---- position: restore once, persist on drag ---- */

async function restorePosition() {
  const saved = getPetPos();
  if (!saved) {
    // No drag position yet → re-anchor to the default corner AFTER the
    // size-based window resize (the Rust-side initial anchor used the
    // creation-size shell, and setSize keeps the top-left corner fixed).
    void invoke("pet_reset_position").catch(() => {});
    return;
  }
  try {
    // Only restore a position that is still on SOME monitor — a saved corner
    // on an unplugged display falls back to the Rust-side default.
    const monitors = await availableMonitors();
    const visible = monitors.some((m) => {
      const inX = saved.x >= m.position.x - 40 && saved.x < m.position.x + m.size.width - 40;
      const inY = saved.y >= m.position.y - 40 && saved.y < m.position.y + m.size.height - 40;
      return inX && inY;
    });
    if (visible) await getCurrentWindow().setPosition(new PhysicalPosition(saved.x, saved.y));
  } catch {
    /* keep the default corner */
  }
}

let moveSaveTimer: ReturnType<typeof setTimeout> | null = null;
void getCurrentWindow()
  .onMoved((e) => {
    if (moveSaveTimer) clearTimeout(moveSaveTimer);
    // While a bubble is open the window is transiently grown — don't persist
    // that shape's position; the shrink after hide triggers a clean save.
    if (bubble.classList.contains("show")) return;
    const pos = { x: e.payload.x, y: e.payload.y };
    moveSaveTimer = setTimeout(() => {
      setPetPos(pos);
      void updateQuadrant();
    }, 250);
  })
  .catch(() => {});

// Zero work while hidden: pet_hide only hides the window, so pause the sprite
// keyframes explicitly instead of trusting the webview to stop compositing.
document.addEventListener("visibilitychange", () => {
  sprite.style.animationPlayState = document.hidden ? "paused" : "running";
  if (!document.hidden) void ensureOnScreen(); // displays may have changed while hidden
});

/* ---- display changes: re-anchor when the monitor set changes ----
 * Unplugging the widescreen / docking the MacBook changes the monitor set;
 * a pet parked on a gone display (or restored to its saved corner there)
 * would be invisible. Poll the monitor signature and, when it changes, snap
 * an off-screen pet back to the default corner (clearing the stale saved
 * position so it is not restored later) and refresh the quadrant alignment. */

let monitorSig = "";

async function monitorsSignature(): Promise<string> {
  const mons = await availableMonitors();
  return mons.map((m) => `${m.position.x},${m.position.y},${m.size.width},${m.size.height}`).join("|");
}

async function ensureOnScreen() {
  try {
    const win = getCurrentWindow();
    const [pos, size, monitors] = await Promise.all([win.outerPosition(), win.outerSize(), availableMonitors()]);
    const cx = pos.x + size.width / 2;
    const cy = pos.y + size.height / 2;
    const visible = monitors.some(
      (m) =>
        cx >= m.position.x &&
        cx < m.position.x + m.size.width &&
        cy >= m.position.y &&
        cy < m.position.y + m.size.height,
    );
    if (!visible) {
      clearPetPos(); // the saved corner belongs to a display that is gone
      await invoke("pet_reset_position");
    }
    await updateQuadrant();
  } catch {
    /* metrics unavailable → try again on the next tick */
  }
}

setInterval(() => {
  void (async () => {
    try {
      const sig = await monitorsSignature();
      if (sig === monitorSig) return;
      monitorSig = sig;
      await ensureOnScreen();
    } catch {
      /* keep the previous signature */
    }
  })();
}, 10_000);

/* ---- boot ---- */

idle();
void (async () => {
  // Size first (quadrant-anchored), THEN position: the initial Rust anchor
  // used the creation-size shell, so the default-corner re-anchor and any
  // saved drag position must apply to the final window size.
  await applySize();
  await restorePosition();
  await updateQuadrant();
  monitorSig = await monitorsSignature().catch(() => "");
})();
