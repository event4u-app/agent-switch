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
import { PhysicalPosition, availableMonitors, getCurrentWindow } from "@tauri-apps/api/window";
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
const stage = document.getElementById("stage") as HTMLDivElement;

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

/** Paint `reaction` — animated when motion allows, else its first frame. */
function paint(reaction: Reaction, loops: number | "infinite") {
  const r = ROWS[reaction];
  sprite.style.backgroundImage = `url(./pets/${getPetChoice()}/spritesheet.webp)`;
  sprite.style.setProperty("--row-y", `${-r.row * FRAME_H}px`);
  sprite.style.setProperty("--end-x", `${-r.frames * FRAME_W}px`);
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

function applySize() {
  stage.style.transform = `scale(${PET_SIZE_FACTOR[getPetSize()]})`;
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
  applySize();
  paint(currentReaction, currentReaction === "idle" ? "infinite" : TRANSIENT_LOOPS);
});

/* ---- position: restore once, persist on drag ---- */

async function restorePosition() {
  const saved = getPetPos();
  if (!saved) return;
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

applySize();
idle();
void restorePosition();
