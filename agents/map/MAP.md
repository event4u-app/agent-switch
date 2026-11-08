# Map of agent-switch

> Built by `agent-config code-graph map`; the commit it describes and its freshness are in `manifest.json` — compare that commit with HEAD yourself.
> Deterministic, no model call. Rebuild with `agent-config code-graph map`; never edit by hand.

**470 files · 19 areas · 7034 trusted links · guess share 2.4 %**

Thresholds: seed 42 · infrastructure above in-degree 57 · areas under 3 files fold into "small parts" · an area above 25 % is split once · lists capped at 15.

Convention providers: none detected — only the framework-neutral default ran.

## Health — B, 67.3 of 100

| Part | Value | Points |
|---|---|---|
| Dead code files | 0.8 % | 24 / 25 |
| File cycles | 4 | 5.2 / 25 |
| Guessed edges | 2.4 % | 23 / 25 |
| Hotspot files | 2 % | 15.1 / 25 |

Formula: `health.formula` in `code/map.json`.

Top findings:

- 4 file cycles
- no layers.yaml, so no layer breaches checked
- 2 dead files (exports unchecked: the extractor records no exportedness, so an exported but unimported file counts as dead; entry files and files reached by a guessed link are never counted)
- hotspot `gui/package-lock.json`: 33 commits × 6998 lines
- hotspot `gui/src/ipc.ts`: 54 commits × 1362 lines

## Knowledge areas

Beside Code, each area is filled by its own reader. Every fact carries a witness (file, line, hash) and its confirm state in `code/map.json` → `areas`, and data, interfaces, runtime and delivery also in a folder each.

- data: data lane (migrations, dumps, snapshots) found nothing — no migration, schema file, committed dump or snapshot was found
- systems: 1 runtime, 2 frameworks, 1011 packages, 3 findings — systems lane (lockfiles, manifests, version files, images, CI)
- interfaces: 6 services, 11 operations, 7 findings — interfaces lane (call sites, contracts, configuration names)
- runtime: runtime lane (compose, Dockerfiles, Terraform, Kubernetes, task files) found nothing — no compose file, Dockerfile, Terraform or Kubernetes manifest was found
- delivery: 4 workflows, 11 jobs, 30 findings — delivery lane (GitHub Actions, GitLab CI)
- impact: no data yet — no reader for this area ran on this tree
- agent: 15 verbs, 0 findings — code-graph CLI and MCP surface

## Areas

Files grouped by folder — a folder above 40 files (or a quarter of them) is split one level deeper — and each
test joins the area of the file it links to most, so an area changes only when its own files do.
*Outside hub folder* is the share of an area's non-test files whose directory differs from its hub's.

| Area | Named after (hub) | Files | Cohesion | Tests | Outside hub folder | Most used |
|---|---|---|---|---|---|---|
| [src](code/areas/src.md) | src | 114 | 49.7 % | 50 % | 0 % | `profiles.ts`, `providers.ts`, `usage.ts` |
| [gui-src-redesign-screens](code/areas/gui-src-redesign-screens.md) | gui/src/redesign/screens | 43 | 27.4 % | 14 % | 32.4 % | `logic.ts`, `protection.tsx`, `prefs.ts` |
| [gui-src](code/areas/gui-src.md) | gui/src | 37 | 48.6 % | 51.4 % | 0 % | `ipc.ts`, `settings-store.ts`, `transforms.ts` |
| [gui-src-i18n](code/areas/gui-src-i18n.md) | gui/src/i18n | 32 | 49.1 % | 3.1 % | 54.8 % | `react.tsx`, `index.ts`, `sessions.ts` |
| [gui-src-ui](code/areas/gui-src-ui.md) | gui/src/ui | 22 | 14.8 % | 9.1 % | 0 % | `Button.tsx`, `Card.tsx`, `Typography.tsx` |
| [gui-src-vm](code/areas/gui-src-vm.md) | gui/src/vm | 22 | 33.9 % | 54.5 % | 0 % | `store.tsx`, `rules.ts`, `load.ts` |
| [gui-src-redesign-engines](code/areas/gui-src-redesign-engines.md) | gui/src/redesign/engines | 17 | 27.5 % | 23.5 % | 0 % | `bus.ts`, `notice-text.ts`, `notifications.ts` |
| [src-link](code/areas/src-link.md) | src/link | 17 | 57.1 % | 41.2 % | 0 % | `requests.ts`, `limits.ts`, `raise.ts` |
| [src-commands](code/areas/src-commands.md) | src/commands | 14 | 8 % | 7.1 % | 0 % | `shared.ts`, `profiles.ts`, `rebind.ts` |
| [gui-src-redesign](code/areas/gui-src-redesign.md) | gui/src/redesign | 5 | 6.3 % | 0 % | 0 % | `Hosts.tsx`, `Shell.tsx`, `shortcuts.ts` |
| [tests](code/areas/tests.md) | tests | 5 | 0 % | 100 % | 0 % | `cli-snapshot.test.ts`, `release-workflow.test.ts`, `shellenv-install-shell.test.ts` |
| gui-scripts | gui/scripts | 4 | 62.5 % | 0 % | 0 % | `fixtures.mjs`, `capture.mjs`, `seed.mjs` |
| gui-src-pet | gui/src/pet | 4 | 35.7 % | 50 % | 0 % | `model.ts`, `model.test.ts`, `welcome.ts` |
| gui-src-redesign-tray | gui/src/redesign/tray | 4 | 35.9 % | 25 % | 0 % | `tray.test.tsx`, `Tray.tsx`, `bridge.ts` |
| scripts | scripts | 4 | 37.5 % | 0 % | 25 % | `validate.py`, `release.mjs`, `petgen.py` |
| gui | gui | 3 | 0 % | 0 % | 0 % | `index.html`, `pet.html`, `tray.html` |
| gui-src-lib | gui/src/lib | 3 | 14.1 % | 33.3 % | 0 % | `utils.ts`, `paths.ts`, `paths.test.ts` |
| starlight | starlight | 3 | 0 % | 0 % | 66.7 % | `package-lock.json`, `generate.mjs`, `sync-assets.mjs` |
| small-root | small parts · . | 1 | 0 % | 0 % | 0 % | `package-lock.json` |

## Infrastructure

Files used by more than 57 other files. They are drawn apart and do not decide areas.

- `gui/package-lock.json` — used by 128 files
- `gui/src/i18n/index.ts` — used by 62 files
- `gui/src/vm/types.ts` — used by 63 files

## Surprising links

Links between two areas that are otherwise barely connected, rarest first.

- `gui/pet.html` → `gui/src/pet-main.ts`
- `gui/scripts/screenshots/capture.mjs` → `package-lock.json`
- `gui/src/redesign/tray/Tray.tsx` → `gui/src/lib/utils.ts`
- `gui/src/redesign/tray/TrayApp.tsx` → `gui/src/i18n/LangKeyed.tsx`
- `gui/src/tray-main.tsx` → `gui/src/redesign/tray/TrayApp.tsx`
- `gui/src/updates.ts` → `src/gui-launch.ts`
- `gui/src/vm/usage-loader.ts` → `src/gui-launch.ts`
- `gui/src/redesign/screens/settings/protection.tsx` → `gui/src/redesign/engines/near-limit.ts`
- `gui/src/redesign/tray/TrayApp.tsx` → `gui/src/redesign/engines/switch-effects.ts`
- `gui/pet.html` → `gui/src/pet/model.test.ts`
- `gui/pet.html` → `gui/src/pet/model.ts`
- `gui/src/main.tsx` → `gui/src/redesign/RedesignApp.tsx`
- `gui/src/redesign/CommandSearch.tsx` → `gui/src/i18n/react.tsx`
- `gui/src/redesign/CommandSearch.tsx` → `gui/src/lib/utils.ts`
- `gui/src/redesign/RedesignApp.tsx` → `gui/src/i18n/LangKeyed.tsx`

## Import cycles

4 file-level cycle(s) between code files (doc links excluded); the largest 4 shown, the first 8 files of each.

- 42 files: `gui/src/i18n/LangKeyed.tsx` · `gui/src/i18n/de/index.ts` · `gui/src/i18n/de/sessions.ts` · `gui/src/i18n/de/settings.ts` · `gui/src/i18n/de/vm.ts` · `gui/src/i18n/en/index.ts` · `gui/src/i18n/en/sessions.ts` · `gui/src/i18n/en/settings.ts` · …
- 5 files: `src/api.ts` · `src/mappings.ts` · `src/profiles.ts` · `src/sessions.ts` · `src/single-load.ts`
- 2 files: `gui/package-lock.json` · `starlight/package-lock.json`
- 2 files: `src/link/pace.ts` · `src/link/raise.ts`

## Entry points

- none declared

## Files by role

*isolated* means no trusted link in or out — never "dead": a file reached by reflection,
a string path or a framework convention the engine does not read is isolated too.

| Role | Files |
|---|---|
| code | 236 |
| test | 120 |
| config | 5 |
| doc | 93 |
| infra | 3 |
| isolated | 13 |

## Guessed links

163 links were resolved by name only (no import, no type) and are not drawn by default; they are 2.4 % of all file-to-file links.

> Budget of 2000 tokens reached — cut: External dependencies. Read one with `agent-config code-graph map --section <name>`; never open `code/map.json` for it.
