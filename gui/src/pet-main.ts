/**
 * Pet window entry (road-to-desktop-pet Phases 1–4). Renders one pet-pack
 * spritesheet (contract: gui/public/pets/README.md) and reacts to events the
 * main window emits from its notification fan-out:
 *
 *   "pet-notification" { kind, title, actionable }  → transient reaction + bubble
 *   "pet-context"      { pct }                      → ambient mood dot
 *
 * Settings arrive via shared localStorage (same origin as the main window) and
 * apply live through the cross-window `storage` event. The one actionable
 * surface is the switch-suggestion bubble: clicking it NAVIGATES to the main
 * window's confirm dialog — the pet itself can never switch anything.
 */

import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
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
  FRAME_H,
  FRAME_W,
  KIND_TO_REACTION,
  PET_IDS,
  PET_SIZE_FACTOR,
  REACTION_COOLDOWN_MS,
  ROWS,
  TRANSIENT_LOOPS,
  contextMood,
  sanitizeBubble,
  type Reaction,
} from "./pet/model.js";

const SHEET_COLS = 8;
const SHEET_ROWS = 9;
import {
  getPetBubbleDuration,
  getPetBubbles,
  getPetChoice,
  getPetMotion,
  getPetPos,
  getPetSize,
  setPetChoice,
  setPetPos,
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

/** Play a transient reaction, then fall back to idle. */
function react(reaction: Reaction) {
  if (transientTimer) clearTimeout(transientTimer);
  currentReaction = reaction;
  paint(reaction, TRANSIENT_LOOPS);
  transientTimer = setTimeout(idle, ROWS[reaction].durationMs * TRANSIENT_LOOPS);
}

function hideBubble() {
  bubble.classList.remove("show", "actionable");
  bubble.onclick = null;
}

function showBubble(text: string, actionable: boolean) {
  if (!getPetBubbles()) return;
  if (bubbleTimer) clearTimeout(bubbleTimer);
  bubble.textContent = sanitizeBubble(text);
  bubble.classList.add("show");
  bubble.classList.toggle("actionable", actionable);
  bubble.onclick = actionable
    ? () => {
        hideBubble();
        // Navigation only: bring the main window up and let ITS confirm
        // dialog own the switch — the compliance line stays a user click.
        void invoke("show_window").catch(() => {});
        void emitTo("main", "pet-open-switch", null).catch(() => {});
      }
    : null;
  // An actionable bubble gets at least the long TTL — it carries a decision.
  const ttl = Math.max(BUBBLE_DURATION_MS[getPetBubbleDuration()], actionable ? BUBBLE_DURATION_MS.long : 0);
  bubbleTimer = setTimeout(hideBubble, ttl);
}

/** Resize sprite AND window to the size setting. The window shrinks with the
 *  pet — leftover transparent area would still swallow clicks (the window is
 *  not click-through), so tight bounds matter more than looks here.
 *
 *  Quadrant anchor: the corner of the window nearest the display edge (judged
 *  by which quadrant of the monitor the window center sits in) stays FIXED
 *  while resizing — bottom-right of the screen → bottom-right corner pinned,
 *  top-right → top-right pinned, etc. Without this, growing the pet from the
 *  default corner pushes its lower part off-screen (setSize keeps top-left). */
async function applySize() {
  const f = PET_SIZE_FACTOR[getPetSize()];
  sprite.style.width = `${FRAME_W * f}px`;
  sprite.style.height = `${FRAME_H * f}px`;
  sprite.style.backgroundSize = `${FRAME_W * SHEET_COLS * f}px ${FRAME_H * SHEET_ROWS * f}px`;
  const logicalW = Math.max(FRAME_W * f + 48, 220); // bubble stays readable
  const logicalH = 24 /* drag strip */ + 44 /* bubble zone */ + FRAME_H * f + 34 /* label + padding */;
  const win = getCurrentWindow();
  try {
    const [pos, size, monitor, scale] = await Promise.all([
      win.outerPosition(),
      win.outerSize(),
      currentMonitor(),
      win.scaleFactor(),
    ]);
    const newW = Math.round(logicalW * scale);
    const newH = Math.round(logicalH * scale);
    let x = pos.x;
    let y = pos.y;
    if (monitor) {
      const centerX = monitor.position.x + monitor.size.width / 2;
      const centerY = monitor.position.y + monitor.size.height / 2;
      if (pos.x + size.width / 2 >= centerX) x = pos.x + size.width - newW; // right half → right edge pinned
      if (pos.y + size.height / 2 >= centerY) y = pos.y + size.height - newH; // bottom half → bottom edge pinned
    }
    await win.setSize(new PhysicalSize(newW, newH));
    if (x !== pos.x || y !== pos.y) await win.setPosition(new PhysicalPosition(x, y));
  } catch {
    // Metrics unavailable (tests / degraded env) → plain resize, no re-anchor.
    void win.setSize(new LogicalSize(logicalW, logicalH)).catch(() => {});
  }
}

/* ---- events from the main window ---- */

interface PetNotification {
  kind: NotificationKind;
  title: string;
  actionable: boolean;
}

void listen<PetNotification>("pet-notification", (e) => {
  const now = Date.now();
  if (now - lastReactionAt < REACTION_COOLDOWN_MS) return;
  lastReactionAt = now;
  react(KIND_TO_REACTION[e.payload.kind] ?? "waving");
  showBubble(e.payload.title, e.payload.actionable);
}).catch(() => {});

void listen<{ pct: number | null }>("pet-context", (e) => {
  const m = contextMood(e.payload.pct);
  mood.className = m ?? "";
}).catch(() => {});

// Dev-mode pose picker (Pet section): hold the selected row until the next
// pick so it can be inspected — a QA tool, so it bypasses the cooldown and
// the transient return-to-idle. Picking "idle" restores normal behavior.
void listen<{ reaction: string }>("pet-pose", (e) => {
  const reaction = e.payload.reaction as Reaction;
  if (!(reaction in ROWS)) return;
  if (transientTimer) clearTimeout(transientTimer);
  currentReaction = reaction;
  paint(reaction, "infinite");
}).catch(() => {});

/* ---- direct interaction ---- */

// A click is a friendly ack (and a quick liveness check), never an action.
sprite.addEventListener("click", () => {
  if (currentReaction === "idle") react("waving");
});

// Right-click cycles through the bundled pets AND persists the choice, so the
// settings picker reflects it (shared localStorage → storage event).
document.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  const ids = PET_IDS;
  const next = ids[(ids.indexOf(getPetChoice()) + 1) % ids.length];
  setPetChoice(next);
  paint(currentReaction, currentReaction === "idle" ? "infinite" : TRANSIENT_LOOPS);
});

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
    const pos = { x: e.payload.x, y: e.payload.y };
    moveSaveTimer = setTimeout(() => setPetPos(pos), 250);
  })
  .catch(() => {});

// Zero work while hidden: pet_hide only hides the window, so pause the sprite
// keyframes explicitly instead of trusting the webview to stop compositing.
document.addEventListener("visibilitychange", () => {
  sprite.style.animationPlayState = document.hidden ? "paused" : "running";
});

/* ---- boot ---- */

idle();
void (async () => {
  // Size first (quadrant-anchored), THEN position: the initial Rust anchor
  // used the creation-size shell, so the default-corner re-anchor and any
  // saved drag position must apply to the final window size.
  await applySize();
  await restorePosition();
})();
