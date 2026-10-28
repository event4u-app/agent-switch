import { useEffect, useState } from "react";
import * as ipc from "../../../ipc.js";
import { cn } from "../../../lib/utils.js";
import type { NotificationKind } from "../../../notifications.js";
import { ALL_REACTIONS, PET_IDS, PET_WELCOME, type BubbleDuration, type PetId, type PetMotion, type PetSize, type PetTier } from "../../../pet/model.js";
import {
  clearPetPos,
  getDevMode,
  getPetBubbleDuration,
  getPetBubbles,
  getPetChoice,
  getPetEnabled,
  getPetLabel,
  getPetPos,
  getPetPosLock,
  getPetPresence,
  getPetPrevPos,
  getPetReactKinds,
  getPetSize,
  getPetMotion,
  getPetTier,
  setPetBubbleDurationFlag,
  setPetBubblesFlag,
  setPetChoice,
  setPetEnabledFlag,
  setPetLabelFlag,
  setPetMotionFlag,
  setPetPosLockFlag,
  setPetPresenceFlag,
  setPetPrevPos,
  setPetReactKinds,
  setPetSizeFlag,
  setPetTierFlag,
  type PetPresence,
} from "../../../settings-store.js";
import { Button } from "../../../ui/Button.js";
import { Card } from "../../../ui/Card.js";
import { Segmented } from "../../../ui/Segmented.js";
import { Select } from "../../../ui/Select.js";
import { SettingGroup, SettingRow } from "../../../ui/Setting.js";
import { Switch } from "../../../ui/Switch.js";
import { KIND_LABELS } from "./notifications.js";
import { usePref } from "./prefs.js";

/** Display names per pet (bundle `O0`). */
export const PET_NAMES: Record<PetId, string> = {
  "agent-switch": "Agent 007 Switch",
  "agent-config-warden": "Iron Law Warden",
  "agent-switch-scout": "Recon Scout",
  "dev-bot": "Dev Bot",
  "event4u-bard": "Folk Metal Bard",
  "event4u-raver": "Festival Raver",
  "event4u-stage-crew": "Stage Crew",
  "the-ceo": "The CEO",
};

export const petThumb = (id: PetId) => `./pets/${id}/thumbnail.png`;

const IS_DEV = import.meta.env.DEV;

function writePetEnabled(on: boolean) {
  setPetEnabledFlag(on);
  void (on ? ipc.petShow() : ipc.petHide());
}

function writePresence(p: PetPresence) {
  setPetPresenceFlag(p);
  // Apply now: a permanent companion appears, message-only hides until the next notification.
  void (p === "always" ? ipc.petShow() : ipc.petHide());
}

type BubbleTest = { label: string; send: () => Promise<void> };

const BUBBLE_TESTS: BubbleTest[] = [
  ...(["success", "error", "warning", "info"] as NotificationKind[]).map((k) => ({
    label: k,
    send: () => ipc.petDeliver(k, `Test ${k} bubble — looking good?`, null, true),
  })),
  { label: "switch suggestion", send: () => ipc.petDeliver("warning", "Usage limit near — suggested profile: claude/test", "switch", true) },
  { label: "update", send: () => ipc.petDeliver("info", "Update available — v9.9.9 (test)", "updates", true) },
  { label: "welcome", send: () => ipc.petDeliver("info", PET_WELCOME, "pet-settings", true) },
];

/** Settings › Desktop pet (bundle `pR`, artboard 13). Everything is written to
 *  settings-store; the pet window applies it live via the `storage` event. */
export function PetSettings() {
  const [on, setOn] = usePref(getPetEnabled, writePetEnabled);
  const [pet, setPet] = usePref<PetId>(getPetChoice, setPetChoice);
  const [presence, setPresence] = usePref<PetPresence>(getPetPresence, writePresence);
  const [tier, setTier] = usePref<PetTier>(getPetTier, setPetTierFlag);
  const [kinds, setKinds] = usePref<NotificationKind[]>(getPetReactKinds, setPetReactKinds);
  const [bubbles, setBubbles] = usePref(getPetBubbles, setPetBubblesFlag);
  const [bubbleDuration, setBubbleDuration] = usePref<BubbleDuration>(getPetBubbleDuration, setPetBubbleDurationFlag);
  const [size, setSize] = usePref<PetSize>(getPetSize, setPetSizeFlag);
  const [motion, setMotion] = usePref<PetMotion>(getPetMotion, setPetMotionFlag);
  const [posLock, setPosLock] = usePref(getPetPosLock, setPetPosLockFlag);
  const [label, setLabel] = usePref(getPetLabel, setPetLabelFlag);
  const [devMode] = useState(() => IS_DEV && getDevMode());
  const [pose, setPose] = useState("idle");
  // One-step position history, written by the pet window at drag start.
  const [prevPos, setPrevPosState] = useState(getPetPrevPos);
  useEffect(() => {
    const sync = () => setPrevPosState(getPetPrevPos());
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  function lastPosition() {
    const prev = getPetPrevPos();
    if (!prev) return;
    const cur = getPetPos();
    if (cur) {
      setPetPrevPos(cur); // swap → pressing again toggles back
      setPrevPosState(cur);
    }
    void ipc.petMoveTo(prev);
  }

  function resetPosition() {
    const cur = getPetPos();
    if (cur) {
      setPetPrevPos(cur); // the corner reset is undoable too
      setPrevPosState(cur);
    }
    clearPetPos();
    void ipc.petResetPosition();
  }

  return (
    <>
      <SettingGroup>
        <SettingRow
          title="Desktop pet"
          detail="An animated companion floating above your windows that reacts to notifications. Purely optional."
        >
          <Switch label="Desktop pet" checked={on} onChange={setOn} />
        </SettingRow>
        {on && (
          <SettingRow title="Pet" detail="Pick your companion." stacked>
            <div role="radiogroup" aria-label="Pet" className="grid w-full grid-cols-4 gap-2 xl:grid-cols-8">
              {PET_IDS.map((id) => {
                const checked = pet === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    title={PET_NAMES[id]}
                    onClick={() => setPet(id)}
                    className={cn(
                      "flex flex-col items-center justify-center gap-1.5 rounded-lg border p-2 transition-colors",
                      checked
                        ? "border-transparent bg-ac-brand-tint shadow-[inset_0_0_0_1px_var(--ac-brand-line)]"
                        : "border-ac-line hover:border-ac-line2",
                    )}
                  >
                    <img src={petThumb(id)} alt="" draggable={false} className="size-12 object-contain [image-rendering:pixelated]" />
                    <span className="w-full truncate text-center text-[10px] text-ac-muted">{PET_NAMES[id]}</span>
                  </button>
                );
              })}
            </div>
          </SettingRow>
        )}
      </SettingGroup>

      {on && (
        <>
          <SettingGroup title="When it shows up">
            <SettingRow
              title="Presence"
              detail="Appear for a notification and hide again afterwards (default), or stay on screen permanently."
            >
              <Segmented<PetPresence>
                label="Presence"
                size="sm"
                value={presence}
                onChange={setPresence}
                options={[
                  { value: "message-only", label: "Only for messages" },
                  { value: "always", label: "Always visible" },
                ]}
              />
            </SettingRow>
            <SettingRow
              title="Notification routing"
              detail="Pet + system (default), pet replaces desktop notifications and toasts, or decoration only."
            >
              <div className="w-[170px]">
                <Select
                  ariaLabel="Notification routing"
                  value={tier}
                  onChange={(v) => setTier(v as PetTier)}
                  options={[
                    { value: "hybrid", label: "Pet + system" },
                    { value: "pet-only", label: "Pet only" },
                    { value: "os-only", label: "Decoration only" },
                  ]}
                />
              </div>
            </SettingRow>
          </SettingGroup>

          {tier !== "os-only" && (
            <SettingGroup
              title="Pet reacts to"
              detail="Independent of the desktop mutes — the pet can cover kinds you muted there."
            >
              {KIND_LABELS.map(({ kind, label: kindLabel, hint }) => (
                <SettingRow key={kind} title={kindLabel} detail={hint}>
                  <Switch
                    label={`Pet reacts to ${kindLabel}`}
                    checked={kinds.includes(kind)}
                    onChange={(v) => setKinds(v ? [...kinds, kind] : kinds.filter((k) => k !== kind))}
                  />
                </SettingRow>
              ))}
            </SettingGroup>
          )}

          <SettingGroup title="Look">
            <SettingRow
              title="Speech bubbles"
              detail="Show the notification title as a bubble; a near-limit bubble opens the suggestion on click."
            >
              {bubbles && (
                <Segmented<BubbleDuration>
                  label="Bubble duration"
                  size="sm"
                  value={bubbleDuration}
                  onChange={setBubbleDuration}
                  options={[
                    { value: "short", label: "Short" },
                    { value: "normal", label: "Normal" },
                    { value: "long", label: "Long" },
                  ]}
                />
              )}
              <Switch label="Speech bubbles" checked={bubbles} onChange={setBubbles} />
            </SettingRow>
            <SettingRow title="Size" detail="How large the pet renders.">
              <Segmented<PetSize>
                label="Size"
                size="sm"
                value={size}
                onChange={setSize}
                options={[
                  { value: "small", label: "Small" },
                  { value: "medium", label: "Medium" },
                  { value: "large", label: "Large" },
                ]}
              />
            </SettingRow>
            <SettingRow
              title="Animations"
              detail="Auto follows the system's reduce-motion preference; Off shows a static sprite."
            >
              <Segmented<PetMotion>
                label="Animations"
                size="sm"
                value={motion}
                onChange={setMotion}
                options={[
                  { value: "auto", label: "Auto" },
                  { value: "on", label: "On" },
                  { value: "off", label: "Off" },
                ]}
              />
            </SettingRow>
          </SettingGroup>

          <SettingGroup title="Position">
            <SettingRow
              title="Position"
              detail="Click and hold the pet to drag it. Reset brings it back to the bottom-right corner; “last position” restores where it was before the most recent move (press again to toggle back)."
            >
              <Button size="sm" disabled={!prevPos} onClick={lastPosition}>
                Last position
              </Button>
              <Button size="sm" onClick={resetPosition}>
                Reset
              </Button>
            </SettingRow>
            <SettingRow
              title="Lock position"
              detail="Prevent dragging the pet (the reset buttons still work). If displays change — dock, unplug — the pet re-anchors itself either way."
            >
              <Switch label="Lock position" checked={posLock} onChange={setPosLock} />
            </SettingRow>
          </SettingGroup>

          <Card className="flex items-center gap-4 p-4">
            <img src={petThumb(pet)} alt="" draggable={false} className="size-16 shrink-0 object-contain [image-rendering:pixelated]" />
            <div className="flex min-w-0 flex-col justify-center gap-1.5">
              <div className="rounded-lg border border-ac-line2 bg-ac-raise px-3 py-2 text-[13px] text-ac-text">{PET_WELCOME}</div>
              <p className="text-[11px] text-ac-faint">Said once, on the very first start — never again at login.</p>
            </div>
          </Card>

          {devMode && (
            <SettingGroup title="Developer">
              <SettingRow
                title="State label"
                detail="Show “pet · reaction” under the sprite. Dev builds only; never shown in production."
              >
                <Switch label="State label" checked={label} onChange={setLabel} />
              </SettingRow>
              <SettingRow
                title="Bubble test"
                detail="Sends one event of each kind straight to the pet — bypasses the notification log and the reaction cooldown."
                stacked
              >
                {BUBBLE_TESTS.map((t) => (
                  <Button key={t.label} size="sm" onClick={() => void t.send()}>
                    {t.label}
                  </Button>
                ))}
              </SettingRow>
              <SettingRow
                title="Pose"
                detail="Make the pet hold a spritesheet row for QA — it keeps looping until you pick another; “idle” restores normal behavior."
                stacked
              >
                {ALL_REACTIONS.map((r) => (
                  <Button
                    key={r}
                    size="sm"
                    variant={pose === r ? "primary" : "secondary"}
                    onClick={() => {
                      setPose(r);
                      void ipc.petEmitPose(r);
                    }}
                  >
                    {r}
                  </Button>
                ))}
              </SettingRow>
            </SettingGroup>
          )}
        </>
      )}
    </>
  );
}
