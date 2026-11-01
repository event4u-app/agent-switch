import { useEffect, useState } from "react";
import { t } from "../../../i18n/index.js";
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

type BubbleTest = { id: string; name: () => string; send: () => Promise<void> };

/** Dev-only bubble tests. Names and texts are read at click/render time
 *  (the language can change); the welcome bubble stays PET_WELCOME. */
const BUBBLE_TESTS: BubbleTest[] = [
  ...(["success", "error", "warning", "info"] as NotificationKind[]).map((k) => ({
    id: k,
    name: () => k,
    send: () => ipc.petDeliver(k, t("settings.pet.testBubble", { kind: k }), null, true),
  })),
  {
    id: "switch",
    name: () => t("settings.pet.testSuggestionLabel"),
    send: () => ipc.petDeliver("warning", t("settings.pet.testSuggestion"), "switch", true),
  },
  {
    id: "update",
    name: () => t("settings.pet.testUpdateLabel"),
    send: () => ipc.petDeliver("info", t("settings.pet.testUpdate"), "updates", true),
  },
  { id: "welcome", name: () => t("settings.pet.testWelcomeLabel"), send: () => ipc.petDeliver("info", PET_WELCOME, "pet-settings", true) },
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
          title={t("settings.pet.enabled")}
          detail={t("settings.pet.enabledDetail")}
        >
          <Switch label={t("settings.pet.enabled")} checked={on} onChange={setOn} />
        </SettingRow>
        {on && (
          <SettingRow title={t("settings.pet.pet")} detail={t("settings.pet.petDetail")} stacked>
            <div role="radiogroup" aria-label={t("settings.pet.pet")} className="grid w-full grid-cols-4 gap-2 xl:grid-cols-8">
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
          <SettingGroup title={t("settings.pet.whenShows")}>
            <SettingRow
              title={t("settings.pet.presence")}
              detail={t("settings.pet.presenceDetail")}
            >
              <Segmented<PetPresence>
                label={t("settings.pet.presence")}
                size="sm"
                value={presence}
                onChange={setPresence}
                options={[
                  { value: "message-only", label: t("settings.pet.presenceMessages") },
                  { value: "always", label: t("settings.pet.presenceAlways") },
                ]}
              />
            </SettingRow>
            <SettingRow
              title={t("settings.pet.routing")}
              detail={t("settings.pet.routingDetail")}
            >
              <div className="w-[170px]">
                <Select
                  ariaLabel={t("settings.pet.routing")}
                  value={tier}
                  onChange={(v) => setTier(v as PetTier)}
                  options={[
                    { value: "hybrid", label: t("settings.pet.routingHybrid") },
                    { value: "pet-only", label: t("settings.pet.routingPetOnly") },
                    { value: "os-only", label: t("settings.pet.routingOsOnly") },
                  ]}
                />
              </div>
            </SettingRow>
          </SettingGroup>

          {tier !== "os-only" && (
            <SettingGroup
              title={t("settings.pet.reactsTo")}
              detail={t("settings.pet.reactsToDetail")}
            >
              {KIND_LABELS.map(({ kind, labelKey, hintKey }) => (
                <SettingRow key={kind} title={t(labelKey)} detail={t(hintKey)}>
                  <Switch
                    label={t("settings.pet.reactsToKind", { kind: t(labelKey) })}
                    checked={kinds.includes(kind)}
                    onChange={(v) => setKinds(v ? [...kinds, kind] : kinds.filter((k) => k !== kind))}
                  />
                </SettingRow>
              ))}
            </SettingGroup>
          )}

          <SettingGroup title={t("settings.pet.look")}>
            <SettingRow
              title={t("settings.pet.bubbles")}
              detail={t("settings.pet.bubblesDetail")}
            >
              {bubbles && (
                <Segmented<BubbleDuration>
                  label={t("settings.pet.bubbleDuration")}
                  size="sm"
                  value={bubbleDuration}
                  onChange={setBubbleDuration}
                  options={[
                    { value: "short", label: t("settings.pet.durationShort") },
                    { value: "normal", label: t("settings.pet.durationNormal") },
                    { value: "long", label: t("settings.pet.durationLong") },
                  ]}
                />
              )}
              <Switch label={t("settings.pet.bubbles")} checked={bubbles} onChange={setBubbles} />
            </SettingRow>
            <SettingRow title={t("settings.pet.size")} detail={t("settings.pet.sizeDetail")}>
              <Segmented<PetSize>
                label={t("settings.pet.size")}
                size="sm"
                value={size}
                onChange={setSize}
                options={[
                  { value: "small", label: t("settings.pet.sizeSmall") },
                  { value: "medium", label: t("settings.pet.sizeMedium") },
                  { value: "large", label: t("settings.pet.sizeLarge") },
                ]}
              />
            </SettingRow>
            <SettingRow
              title={t("settings.pet.animations")}
              detail={t("settings.pet.animationsDetail")}
            >
              <Segmented<PetMotion>
                label={t("settings.pet.animations")}
                size="sm"
                value={motion}
                onChange={setMotion}
                options={[
                  { value: "auto", label: t("settings.pet.motionAuto") },
                  { value: "on", label: t("common.on") },
                  { value: "off", label: t("common.off") },
                ]}
              />
            </SettingRow>
          </SettingGroup>

          <SettingGroup title={t("settings.pet.position")}>
            <SettingRow
              title={t("settings.pet.position")}
              detail={t("settings.pet.positionDetail")}
            >
              <Button size="sm" disabled={!prevPos} onClick={lastPosition}>
                {t("settings.pet.lastPosition")}
              </Button>
              <Button size="sm" onClick={resetPosition}>
                {t("settings.pet.reset")}
              </Button>
            </SettingRow>
            <SettingRow
              title={t("settings.pet.lockPosition")}
              detail={t("settings.pet.lockPositionDetail")}
            >
              <Switch label={t("settings.pet.lockPosition")} checked={posLock} onChange={setPosLock} />
            </SettingRow>
          </SettingGroup>

          <Card className="flex items-center gap-4 p-4">
            <img src={petThumb(pet)} alt="" draggable={false} className="size-16 shrink-0 object-contain [image-rendering:pixelated]" />
            <div className="flex min-w-0 flex-col justify-center gap-1.5">
              <div className="rounded-lg border border-ac-line2 bg-ac-raise px-3 py-2 text-[13px] text-ac-text">{PET_WELCOME}</div>
              <p className="text-[11px] text-ac-faint">{t("settings.pet.welcomeNote")}</p>
            </div>
          </Card>

          {devMode && (
            <SettingGroup title={t("settings.pet.developer")}>
              <SettingRow
                title={t("settings.pet.stateLabel")}
                detail={t("settings.pet.stateLabelDetail")}
              >
                <Switch label={t("settings.pet.stateLabel")} checked={label} onChange={setLabel} />
              </SettingRow>
              <SettingRow
                title={t("settings.pet.bubbleTest")}
                detail={t("settings.pet.bubbleTestDetail")}
                stacked
              >
                {BUBBLE_TESTS.map((b) => (
                  <Button key={b.id} size="sm" onClick={() => void b.send()}>
                    {b.name()}
                  </Button>
                ))}
              </SettingRow>
              <SettingRow
                title={t("settings.pet.pose")}
                detail={t("settings.pet.poseDetail")}
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
