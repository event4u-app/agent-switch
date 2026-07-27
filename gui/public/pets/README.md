# event4u Pet Pack für OpenPets

Acht Pixel-Art-Pets im Format von [alvinunreal/openpets](https://github.com/alvinunreal/openpets),
passend zu `event4u-app/agent-switch` und `event4u-app/agent-config`.

![Banner](banner.png)

| Pet | ID | Passt zu |
|---|---|---|
| **Agent 007 Switch** — Trenchcoat, Fedora, Profil-Badge, Toggle-Glyph | `agent-switch-007` | agent-switch (Profil-/Identitätswechsel) |
| **Iron Law Warden** — Helm mit Hörnern, Gürtelplatte, Bernstein-Visier | `agent-config-warden` | agent-config (Kernel, Iron Laws, Gates) |
| **Recon Scout** — Cap, Feldjacke, grünes Visier | `agent-switch-scout` | agent-switch (Zweitfarbe / Multi-Session) |
| **Festival Raver** — Cap rückwärts, Kopfhörer, Lanyard, Glowstick | `event4u-raver` | event4u (Besucher, Ticket-Scan) |
| **Stage Crew** — Beanie, Headset, Warnweste, Mischpult | `event4u-stage-crew` | event4u (Betrieb, Ablauf) |
| **Folk Metal Bard** — lange Haare, Nietengürtel, Axt | `event4u-bard` | event4u / horn_and_ash |
| **Dev Bot** — Hoodie auf, Terminal-grünes Visier, Kaffee | `dev-bot` | generisch, lange Sessions |
| **The CEO** — Anzug, Krawatte, Earpiece, Balkendiagramm | `the-ceo` | generisch, Demo/Screenshot |

Zustandsbezogene Props pro Pet (`review` / `running` / `waving`):

| Pet | review | running | waving |
|---|---|---|---|
| agent-switch-007 | Lupe + Profil-Toggle | Konsole | Funke |
| agent-config-warden | Lupe | Konsole | Funke |
| agent-switch-scout | Lupe + Profil-Toggle | Konsole | Funke |
| event4u-raver | Ticket-Scanner | Konsole | Glowstick |
| event4u-stage-crew | Klemmbrett | Mischpult mit Fadern | Funke |
| event4u-bard | Klemmbrett | Konsole | Axt |
| dev-bot | Lupe | Konsole | Kaffeetasse |
| the-ceo | Balkendiagramm | Balkendiagramm | Kaffeetasse |

## Technischer Vertrag

Abgeleitet aus `apps/desktop/src/reaction-animation-mapping.ts` und
`apps/desktop/src/codex-pets-core.ts` des OpenPets-Repos:

- Spritesheet: **1536 × 1872 px**, lossless WebP, RGBA mit Transparenz
- Raster: **8 Spalten × 9 Zeilen**, Frame **192 × 208 px**
- `pet.json`: `id` muss dem Ordnernamen entsprechen, `spritesheetPath` muss exakt `spritesheet.webp` sein

| Row | State | Frames | durationMs |
|---|---|---|---|
| 0 | idle | 6 | 5500 (infinite) |
| 1 | running-right | 8 | 1060 |
| 2 | running-left | 8 | 1060 |
| 3 | waving | 4 | 700 (×2) |
| 4 | jumping | 5 | 840 (×2) |
| 5 | failed | 8 | 1220 (×2) |
| 6 | waiting | 6 | 1010 |
| 7 | running | 6 | 820 |
| 8 | review | 6 | 1030 |

Reaction-Mapping des Hosts (Default): `thinking→review`, `working/editing/running→running`,
`testing/waiting→waiting`, `success/celebrating→jumping`, `error→failed`, `waving→waving`.

## Installation

**Variante A — lokale Autoren-Pets (Dev-Workflow, kein Katalog nötig):**

```bash
mkdir -p ~/.codex/pets
for p in agent-switch-007 agent-config-warden agent-switch-scout \
         event4u-raver event4u-stage-crew event4u-bard dev-bot the-ceo; do
  cp -R "$p" ~/.codex/pets/
done
```

Danach in OpenPets unter den Codex-Pets importieren. Wichtig: Ordnername == `id`.

**Variante B — ZIP-Import über die laufende App:**

```bash
openpets install --from-zip "$(pwd)/agent-switch-007.zip"
openpets install --from-folder "$(pwd)/agent-config-warden"
```

## Test

```bash
bunx @open-pets/claude-pets test-event thinking   # -> review
bunx @open-pets/claude-pets test-event error      # -> failed
bunx @open-pets/claude-pets test-event success    # -> jumping
```

## Regenerieren / anpassen

`petgen.py` erzeugt alles prozedural auf einem 48 × 52-Logikraster (4× Nearest-Neighbor-Scale).
Neue Varianten entstehen über eine Palette plus `kind`-Flag:

```python
MYPAL = palette(visor=(255,120,90,255), accent=(255,120,90,255), coat=(40,32,44,255))
PETS.append(dict(id="my-pet", kind="spy", pal=MYPAL,
                 displayName="…", description="…",
                 props=dict(review="scanner", work="mixer", hand="mug")))
```

`kind` steuert Kopfbedeckung und Körperdetails: `spy`, `warden`, `scout`, `raver`,
`crew`, `bard`, `dev`, `ceo`. `props` wählt die Requisiten:
`review` ∈ {magnifier, scanner, clipboard, chart}, `work` ∈ {console, mixer, chart},
`hand` ∈ {none, glowstick, guitar, mug}.

`package_pets.py` baut daraus GIF-Previews pro State, `states.png` für die Doku,
den Banner und die installierbaren ZIPs.

## QA-Status

Automatisch verifiziert für alle acht Pets (`validate.py`): Sheet-Maße, `pet.json`-Schema,
Frame-Anzahl pro Zeile, keine leeren Frames, jede Zeile animiert tatsächlich,
ungenutzte Spalten leer, **kein Frame am Rand abgeschnitten**.

Letzterer Check hat einen echten Fehler gefunden: der Lupengriff des Spy-Pets und
mehrere Props der neuen Pets ragten über die 48×52-Fläche hinaus und wurden
beschnitten. Behoben über Per-Prop-Offsets in `REVIEW_PROPS` / `HAND_PROPS`.

## Lizenz & Marken

Assets sind originär und prozedural erzeugt — keine fremden Sprites, keine
Anthropic-Marken. Bewusst **kein** Claude-Logo (Starburst) verwendet: das ist eine
geschützte Wortbild-Marke von Anthropic, und ein davon abgeleitetes Maskottchen in
einem Distributionskanal wäre markenrechtlich heikel. Der Spy-Charakter transportiert
dieselbe Idee ("Agent, der Identitäten wechselt") ohne dieses Risiko.

Empfehlung: MIT bzw. CC-BY-4.0 im Repo ergänzen, passend zur Lizenz von agent-switch.
