# Map of agent-switch

> Built by `agent-config code-graph map`; the commit it describes and its freshness are in `manifest.json` — compare that commit with HEAD yourself.
> Deterministic, no model call. Rebuild with `agent-config code-graph map`; never edit by hand.

**721 files · 31 areas · 10607 trusted links · guess share 3.5 %**

Thresholds: seed 42 · infrastructure above in-degree 66 · areas under 3 files fold into "small parts" · an area above 25 % is split once · lists capped at 15.

Convention providers: none detected — only the framework-neutral default ran.

## Health — B, 62 of 100

| Part | Value | Points |
|---|---|---|
| Dead code files | 0.5 % | 24.3 / 25 |
| File cycles | 10 | 0 / 25 |
| Guessed edges | 3.5 % | 22.1 / 25 |
| Hotspot files | 1.9 % | 15.6 / 25 |

Formula: `health.formula` in `code/map.json`.

Top findings:

- 10 file cycles
- no layers.yaml, so no layer breaches checked
- 2 dead files (exports unchecked: the extractor records no exportedness, so an exported but unimported file counts as dead; entry files and files reached by a guessed link are never counted)
- hotspot `gui/package-lock.json`: 32 commits × 7018 lines
- hotspot `gui/src/ipc.ts`: 75 commits × 1728 lines

## Knowledge areas

Beside Code, each area is filled by its own reader. Every fact carries a witness (file, line, hash) and its confirm state in `code/map.json` → `areas`, and data, interfaces, runtime and delivery also in a folder each.

- data: data lane (migrations, dumps, snapshots) found nothing — no migration, schema file, committed dump or snapshot was found
- systems: 1 runtime, 2 frameworks, 1013 packages, 3 findings — systems lane (lockfiles, manifests, version files, images, CI)
- interfaces: 6 services, 11 operations, 7 findings — interfaces lane (call sites, contracts, configuration names)
- runtime: runtime lane (compose, Dockerfiles, Terraform, Kubernetes, task files) found nothing — no compose file, Dockerfile, Terraform or Kubernetes manifest was found
- delivery: 4 workflows, 12 jobs, 33 findings — delivery lane (GitHub Actions, GitLab CI)
- impact: no data yet — no reader for this area ran on this tree
- agent: 15 verbs, 0 findings — code-graph CLI and MCP surface

## Areas

Files grouped by folder — a folder above 40 files (or a quarter of them) is split one level deeper — and each
test joins the area of the file it links to most, so an area changes only when its own files do.
*Outside hub folder* is the share of an area's non-test files whose directory differs from its hub's.

| Area | Named after (hub) | Files | Cohesion | Tests | Outside hub folder | Most used |
|---|---|---|---|---|---|---|
| [src](code/areas/src.md) | src | 146 | 48.2 % | 50 % | 0 % | `providers.ts`, `api.ts`, `usage.ts` |
| [gui-src-v3](code/areas/gui-src-v3.md) | gui/src/v3 | 67 | 54.2 % | 50.7 % | 0 % | `kit.tsx`, `timeline.ts`, `sessions.tsx` |
| [gui-src-redesign-screens](code/areas/gui-src-redesign-screens.md) | gui/src/redesign/screens | 46 | 26.4 % | 17.4 % | 34.2 % | `logic.ts`, `prefs.ts`, `protection.tsx` |
| [gui-src](code/areas/gui-src.md) | gui/src | 35 | 38.3 % | 48.6 % | 0 % | `transforms.ts`, `settings-store.ts`, `notifications.ts` |
| [gui-src-i18n](code/areas/gui-src-i18n.md) | gui/src/i18n | 33 | 21.1 % | 3 % | 87.5 % | `index.ts`, `react.tsx`, `index.ts` |
| [src-commands](code/areas/src-commands.md) | src/commands | 33 | 7.8 % | 12.1 % | 0 % | `shared.ts`, `bridge.ts`, `needs.ts` |
| [gui-src-vm](code/areas/gui-src-vm.md) | gui/src/vm | 28 | 32.4 % | 60.7 % | 0 % | `store.tsx`, `rules.ts`, `load.ts` |
| [gui-src-v3-adapter](code/areas/gui-src-v3-adapter.md) | gui/src/v3/adapter | 27 | 35.6 % | 44.4 % | 0 % | `data.ts`, `slots.tsx`, `feeds.ts` |
| [gui-src-ui](code/areas/gui-src-ui.md) | gui/src/ui | 22 | 12.8 % | 9.1 % | 0 % | `Button.tsx`, `Typography.tsx`, `Card.tsx` |
| [gui-src-redesign-engines](code/areas/gui-src-redesign-engines.md) | gui/src/redesign/engines | 18 | 26.6 % | 27.8 % | 0 % | `bus.ts`, `notice-text.ts`, `test-storage.ts` |
| [src-link](code/areas/src-link.md) | src/link | 17 | 54.2 % | 41.2 % | 0 % | `requests.ts`, `limits.ts`, `pace.ts` |
| [src-bridge](code/areas/src-bridge.md) | src/bridge | 12 | 50.8 % | 50 % | 0 % | `pending.ts`, `inbox.ts`, `claude-bridge.ts` |
| [gui-src-v3-markdown](code/areas/gui-src-v3-markdown.md) | gui/src/v3/markdown | 9 | 74.7 % | 33.3 % | 0 % | `Markdown.tsx`, `fixtures.ts`, `parse.ts` |
| [tests](code/areas/tests.md) | tests | 9 | 0 % | 100 % | 0 % | `cli-snapshot.test.ts`, `cli-e2e-acp.test.ts`, `release-workflow.test.ts` |
| [gui](code/areas/gui.md) | gui | 8 | 0 % | 100 % | 0 % | `ipc-bridge-scope.test.ts`, `silent-start.test.ts`, `lint.test.ts` |
| [gui-scripts](code/areas/gui-scripts.md) | gui/scripts | 8 | 60 % | 0 % | 0 % | `fixtures.mjs`, `seed.mjs`, `tauri-shim.mjs` |
| [scripts](code/areas/scripts.md) | scripts | 7 | 27.3 % | 0 % | 57.1 % | `validate.py`, `release.mjs`, `petgen.py` |
| [gui-src-v3-themes](code/areas/gui-src-v3-themes.md) | gui/src/v3/themes | 6 | 43.1 % | 50 % | 0 % | `resolve.ts`, `registry.ts`, `settings.test.tsx` |
| [src-host](code/areas/src-host.md) | src/host | 6 | 33.3 % | 66.7 % | 0 % | `tmux-host.ts`, `lease.ts`, `tmux-host.test.ts` |
| [gui-src-redesign](code/areas/gui-src-redesign.md) | gui/src/redesign | 5 | 6 % | 0 % | 0 % | `Hosts.tsx`, `Shell.tsx`, `shortcuts.ts` |
| [gui-src-redesign-tray](code/areas/gui-src-redesign-tray.md) | gui/src/redesign/tray | 5 | 31 % | 40 % | 0 % | `TrayApp.tsx`, `bridge.ts`, `tray.test.tsx` |
| [src-timeline](code/areas/src-timeline.md) | src/timeline | 5 | 53.8 % | 40 % | 0 % | `events.ts`, `claude.ts`, `codex.ts` |
| gui-src-pet | gui/src/pet | 4 | 35.7 % | 50 % | 0 % | `model.ts`, `model.test.ts`, `welcome.ts` |
| src-engine | src/engine | 4 | 22.1 % | 25 % | 0 % | `server.ts`, `client.ts`, `run.ts` |
| gui-2 | gui | 3 | 0 % | 0 % | 0 % | `index.html`, `pet.html`, `tray.html` |

6 smaller areas are listed in `code/map.json` and in `index.html`.

## Infrastructure

Files used by more than 66 other files. They are drawn apart and do not decide areas.

- `gui/package-lock.json` — used by 235 files
- `gui/src/ipc.ts` — used by 84 files
- `gui/src/vm/types.ts` — used by 76 files
- `src/profiles.ts` — used by 67 files

## Surprising links

Links between two areas that are otherwise barely connected, rarest first.

- `gui/pet.html` → `gui/src/pet-main.ts`
- `gui/src/redesign/screens/settings/advanced.tsx` → `gui/src/v3/markdown/Markdown.tsx`
- `gui/src/redesign/tray/Tray.tsx` → `gui/src/lib/utils.ts`
- `gui/src/tray-main.tsx` → `gui/src/redesign/tray/TrayApp.tsx`
- `gui/src/updates.ts` → `src/gui-launch.ts`
- `gui/src/v3/design-fixture/main.tsx` → `gui/src/redesign/screens/settings/claude.tsx`
- `gui/src/v3/design-fixture/main.tsx` → `gui/src/terminal.ts`
- `gui/src/v3/design-fixture/main.tsx` → `gui/src/ui/AcRoot.tsx`
- `gui/src/v3/markdown/Markdown.tsx` → `gui/src/lib/utils.ts`
- `gui/src/vm/usage-loader.ts` → `src/gui-launch.ts`
- `tests/bridge-pending.test.ts` → `src/engine/server.ts`
- `tests/bridge-pending.test.ts` → `src/store/store.ts`
- `gui/src/i18n/i18n.test.ts` → `gui/src/pet/model.ts`
- `gui/src/redesign/screens/settings/protection.tsx` → `gui/src/redesign/engines/near-limit.ts`
- `gui/src/redesign/tray/TrayApp.tsx` → `gui/src/redesign/engines/switch-effects.ts`

## Entry points

- none declared

## Files by role

*isolated* means no trusted link in or out — never "dead": a file reached by reflection,
a string path or a framework convention the engine does not read is isolated too.

| Role | Files |
|---|---|
| code | 354 |
| test | 222 |
| config | 5 |
| doc | 123 |
| infra | 4 |
| isolated | 13 |

## Guessed links

348 links were resolved by name only (no import, no type) and are not drawn by default; they are 3.5 % of all file-to-file links.

> Budget of 2000 tokens reached — cut: Cycles, External dependencies. Read one with `agent-config code-graph map --section <name>`; never open `code/map.json` for it.
