// SPIKE (road-to-desktop-pet Phase 0): renders a pet-pack spritesheet against
// the row contract in gui/public/pets/README.md. Left-click cycles reactions,
// right-click cycles pets, top strip drags the window.

type Row = { name: string; row: number; frames: number; durationMs: number };

const ROWS: Row[] = [
  { name: "idle", row: 0, frames: 6, durationMs: 5500 },
  { name: "review", row: 8, frames: 6, durationMs: 1030 },
  { name: "running", row: 7, frames: 6, durationMs: 820 },
  { name: "waiting", row: 6, frames: 6, durationMs: 1010 },
  { name: "waving", row: 3, frames: 4, durationMs: 700 },
  { name: "jumping", row: 4, frames: 5, durationMs: 840 },
  { name: "failed", row: 5, frames: 8, durationMs: 1220 },
];

const PETS = [
  "agent-switch-007",
  "agent-config-warden",
  "agent-switch-scout",
  "dev-bot",
  "event4u-bard",
  "event4u-raver",
  "event4u-stage-crew",
  "the-ceo",
];

const FRAME_W = 192;
const FRAME_H = 208;

let petIdx = 0;
let rowIdx = 0;

const sprite = document.getElementById("sprite") as HTMLDivElement;
const label = document.getElementById("label") as HTMLDivElement;

function apply(): void {
  const r = ROWS[rowIdx];
  sprite.style.backgroundImage = `url(./pets/${PETS[petIdx]}/spritesheet.webp)`;
  sprite.style.setProperty("--row-y", `${-r.row * FRAME_H}px`);
  sprite.style.setProperty("--end-x", `${-r.frames * FRAME_W}px`);
  // Restart the keyframe animation from frame 0 on every switch.
  sprite.style.animation = "none";
  void sprite.offsetWidth;
  sprite.style.animation = `pet-frames ${r.durationMs}ms steps(${r.frames}) infinite`;
  label.textContent = `${PETS[petIdx]} · ${r.name}`;
}

sprite.addEventListener("click", () => {
  rowIdx = (rowIdx + 1) % ROWS.length;
  apply();
});

document.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  petIdx = (petIdx + 1) % PETS.length;
  rowIdx = 0;
  apply();
});

apply();
