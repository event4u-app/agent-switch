# Map of agent-switch

> Map built at `e05e35f69a5f` · 2026-11-01 by `agent-config code-graph map` — this describes that commit; compare it with HEAD yourself.
> Deterministic, no model call. Rebuild with `agent-config code-graph map`; never edit by hand.

**416 files · 19 areas · 6181 trusted links · guess share 1.5 %**

Thresholds: seed 42 · infrastructure above in-degree 56 · areas under 3 files fold into "small parts" · an area above 25 % is split once · lists capped at 15.

Convention providers: none detected — only the framework-neutral default ran.

## Health — B, 61.7 of 100

| Part | Value | Points |
|---|---|---|
| Dead code files | 1.3 % | 23.4 / 25 |
| File cycles | 5 | 0 / 25 |
| Guessed edges | 1.5 % | 23.8 / 25 |
| Hotspot files | 2.1 % | 14.5 / 25 |

Formula: `health.formula` in `code/map.json`.

Top findings:

- 5 file cycles
- no layers.yaml, so no layer breaches checked
- 3 dead files (exports unchecked: the extractor records no exportedness, so an exported but unimported file counts as dead; entry files and files reached by a guessed link are never counted)
- hotspot `gui/package-lock.json`: 21 commits × 6998 lines
- hotspot `gui/src/ipc.ts`: 49 commits × 1269 lines

## Knowledge areas

Beside Code, each area is filled by its own reader. Every fact carries a witness (file, line, hash) and its confirm state in `code/map.json` → `areas`, and data, interfaces, runtime and delivery also in a folder each.

- data: data lane (migrations, dumps, snapshots) found nothing — no migration, schema file, committed dump or snapshot was found
- systems: 1 runtime, 2 frameworks, 1002 packages, 4 findings — systems lane (lockfiles, manifests, version files, images, CI)
- interfaces: 6 services, 11 operations, 7 findings — interfaces lane (call sites, contracts, configuration names)
- runtime: runtime lane (compose, Dockerfiles, Terraform, Kubernetes, task files) found nothing — no compose file, Dockerfile, Terraform or Kubernetes manifest was found
- delivery: 4 workflows, 10 jobs, 28 findings — delivery lane (GitHub Actions, GitLab CI)
- impact: review-risk over the working diff found nothing — no change against HEAD
- agent: 15 verbs, 0 findings — code-graph CLI and MCP surface

## Since the last map

- a1 src/profiles.ts: +4 / −1 files
- a3 gui/src/vm/build.ts: +2 / −3 files
- a7 src/usage.ts: +1 / −1 files
- a8 src/rebind.ts: +0 / −3 files
- gone: `small parts · .claude/worktrees`

## Areas

Files grouped by how they are coupled, not by folder. *Outside hub folder* is the share of an
area's non-test files whose directory differs from its hub's — where the folder layout and the
actual dependencies disagree.

| Area | Named after (hub) | Files | Cohesion | Tests | Outside hub folder | Most used |
|---|---|---|---|---|---|---|
| [a1](code/areas/a1.md) | src/profiles.ts | 74 | 81.5 % | 39.2 % | 28.9 % | `profiles.ts`, `providers.ts`, `api.ts` |
| [a2](code/areas/a2.md) | gui/src/vm/store.tsx | 73 | 57.5 % | 23.3 % | 94.6 % | `store.tsx`, `utils.ts`, `Button.tsx` |
| [a3](code/areas/a3.md) | gui/src/vm/build.ts | 40 | 56.7 % | 37.5 % | 76 % | `transforms.ts`, `load.ts`, `actions.ts` |
| [a4](code/areas/a4.md) | gui/src/settings-store.ts | 30 | 51.7 % | 23.3 % | 82.6 % | `settings-store.ts`, `Switch.tsx`, `model.ts` |
| [a5](code/areas/a5.md) | gui/src/i18n/en/index.ts | 28 | 85.1 % | 0 % | 50 % | `index.ts`, `accounts.ts`, `common.ts` |
| [a6](code/areas/a6.md) | gui/src/ipc.ts | 16 | 59 % | 43.8 % | 33.3 % | `ipc.ts`, `startup.ts`, `theme.ts` |
| [a7](code/areas/a7.md) | src/usage.ts | 12 | 53.8 % | 50 % | 16.7 % | `usage.ts`, `history.ts`, `codex-usage.ts` |
| [a8](code/areas/a8.md) | src/rebind.ts | 10 | 59 % | 60 % | 0 % | `keychain.ts`, `rebind.ts`, `agy-keychain.ts` |
| [a9](code/areas/a9.md) | small parts · src | 8 | 70.6 % | 50 % | 0 % | `hooks.ts`, `session-preview.ts`, `gui-launch.ts` |
| [a10](code/areas/a10.md) | src/tooling.ts | 6 | 70.2 % | 50 % | 0 % | `updates.ts`, `tooling.ts`, `release-notes.ts` |
| [a11](code/areas/a11.md) | gui/scripts/screenshots/capture.mjs | 5 | 85.7 % | 0 % | 20 % | `fixtures.mjs`, `seed.mjs`, `tauri-shim.mjs` |
| a12 | src/share.ts | 4 | 50.9 % | 50 % | 0 % | `share.ts`, `config-transfer.ts`, `config-transfer.test.ts` |
| a13 | src/telemetry.ts | 4 | 64 % | 50 % | 0 % | `telemetry.ts`, `handoff.ts`, `telemetry.test.ts` |
| a14 | small parts · scripts/pets | 3 | 50 % | 0 % | 0 % | `validate.py`, `petgen.py`, `package_pets.py` |
| a15 | src/notify.ts | 3 | 55.6 % | 66.7 % | 0 % | `notify.ts`, `daemon-context.test.ts`, `notify.test.ts` |
| a16 | small parts · gui | 2 | 0 % | 0 % | 0 % | `index.html`, `tray.html` |
| a17 | small parts · gui/src | 1 | 0 % | 0 % | 0 % | `test-setup.ts` |
| a18 | small parts · scripts | 1 | 0 % | 0 % | 0 % | `release.mjs` |
| a19 | small parts · starlight | 1 | 0 % | 0 % | 0 % | `package-lock.json` |

## Infrastructure

Files used by more than 56 other files. They are drawn apart and do not decide areas.

- `gui/package-lock.json` — used by 125 files
- `gui/src/i18n/index.ts` — used by 61 files
- `gui/src/vm/types.ts` — used by 57 files

## Surprising links

Links between two areas that are otherwise barely connected, rarest first.

- `gui/src/redesign/engines/notice-text.ts` → `gui/src/i18n/en/index.ts`
- `gui/src/redesign/screens/logic.ts` → `gui/src/i18n/en/index.ts`
- `gui/src/redesign/screens/session-sheet.tsx` → `gui/src/i18n/en/index.ts`
- `src/daemon.ts` → `src/notify.ts`
- `src/commands/sessions.ts` → `src/notify.ts`
- `tests/daemon-context.test.ts` → `src/daemon.ts`
- `tests/daemon-context.test.ts` → `src/sessions.ts`
- `src/commands/sharing.ts` → `src/share.ts`
- `src/commands/sharing.ts` → `src/config-transfer.ts`
- `src/doctor.ts` → `src/share.ts`
- `src/mappings.ts` → `src/share.ts`
- `src/commands/takeover.ts` → `src/handoff.ts`
- `src/handoff.ts` → `src/sessions.ts`
- `src/commands/shared.ts` → `src/telemetry.ts`
- `src/commands/sessions.ts` → `src/telemetry.ts`

## Import cycles

5 file-level cycle(s) between code files (doc links excluded); the largest 5 shown, the first 8 files of each.

- 5 files: `src/api.ts` · `src/mappings.ts` · `src/profiles.ts` · `src/sessions.ts` · `src/single-load.ts`
- 3 files: `gui/src/redesign/screens/logic.ts` · `gui/src/redesign/screens/session-sheet.tsx` · `gui/src/redesign/screens/start-session.tsx`
- 2 files: `gui/package-lock.json` · `starlight/package-lock.json`
- 2 files: `gui/src/vm/actions.ts` · `gui/src/vm/store.tsx`
- 2 files: `gui/src/vm/build.ts` · `gui/src/vm/load.ts`

## Entry points

- none declared

## Files by role

*isolated* means no trusted link in or out — never "dead": a file reached by reflection,
a string path or a framework convention the engine does not read is isolated too.

| Role | Files |
|---|---|
| code | 221 |
| test | 104 |
| config | 5 |
| doc | 69 |
| infra | 3 |
| isolated | 14 |

## External dependencies

- `node:fs` — imported by 99 files
- `node:path` — imported by 98 files
- `react` — imported by 60 files
- `node:assert/strict` — imported by 56 files
- `node:test` — imported by 56 files
- `node:os` — imported by 54 files
- `vitest` — imported by 48 files
- `node:child_process` — imported by 35 files
- `lucide-react` — imported by 30 files
- `node:url` — imported by 25 files
- `@testing-library/react` — imported by 13 files
- `node:crypto` — imported by 7 files
- `@tauri-apps/api/core` — imported by 6 files
- `@tauri-apps/api/event` — imported by 4 files
- `@tauri-apps/api/webviewWindow` — imported by 4 files
- `@tauri-apps/plugin-shell` — imported by 3 files
- `PIL` — imported by 3 files
- `json` — imported by 3 files
- `os` — imported by 3 files
- `../src-tauri/tauri.conf.json?raw` — imported by 2 files
- `PIL::Draw` — imported by 2 files
- `PIL::new` — imported by 2 files
- `node:readline` — imported by 2 files
- `react-dom/client` — imported by 2 files
- `vite` — imported by 2 files

> Budget of 2000 tokens reached — cut: Guesses. Read one with `agent-config code-graph map --section <name>`; never open `code/map.json` for it.
