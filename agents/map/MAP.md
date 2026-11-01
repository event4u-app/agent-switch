# Map of agent-switch

> Map built at `257525886df0` · 2026-11-01 by `agent-config code-graph map` — this describes that commit; compare it with HEAD yourself.
> Deterministic, no model call. Rebuild with `agent-config code-graph map`; never edit by hand.

**442 files · 23 areas · 6386 trusted links · guess share 1.4 %**

Thresholds: seed 42 · infrastructure above in-degree 56 · areas under 3 files fold into "small parts" · an area above 25 % is split once · lists capped at 15.

Convention providers: none detected — only the framework-neutral default ran.

## Health — B, 61.8 of 100

| Part | Value | Points |
|---|---|---|
| Dead code files | 1.2 % | 23.4 / 25 |
| File cycles | 5 | 0 / 25 |
| Guessed edges | 1.4 % | 23.8 / 25 |
| Hotspot files | 2.1 % | 14.6 / 25 |

Formula: `health.formula` in `code/map.json`.

Top findings:

- 5 file cycles
- no layers.yaml, so no layer breaches checked
- 3 dead files (exports unchecked: the extractor records no exportedness, so an exported but unimported file counts as dead; entry files and files reached by a guessed link are never counted)
- hotspot `gui/package-lock.json`: 25 commits × 6998 lines
- hotspot `gui/src/ipc.ts`: 49 commits × 1269 lines

## Knowledge areas

Beside Code, each area is filled by its own reader. Every fact carries a witness (file, line, hash) and its confirm state in `code/map.json` → `areas`, and data, interfaces, runtime and delivery also in a folder each.

- data: data lane (migrations, dumps, snapshots) found nothing — no migration, schema file, committed dump or snapshot was found
- systems: 1 runtime, 2 frameworks, 1011 packages, 3 findings — systems lane (lockfiles, manifests, version files, images, CI)
- interfaces: 6 services, 11 operations, 7 findings — interfaces lane (call sites, contracts, configuration names)
- runtime: runtime lane (compose, Dockerfiles, Terraform, Kubernetes, task files) found nothing — no compose file, Dockerfile, Terraform or Kubernetes manifest was found
- delivery: 4 workflows, 11 jobs, 30 findings — delivery lane (GitHub Actions, GitLab CI)
- impact: 22 changed files since HEAD, 0 affected items, 0 findings — review-risk over the working diff
- agent: 15 verbs, 0 findings — code-graph CLI and MCP surface

## Areas

Files grouped by how they are coupled, not by folder. *Outside hub folder* is the share of an
area's non-test files whose directory differs from its hub's — where the folder layout and the
actual dependencies disagree.

| Area | Named after (hub) | Files | Cohesion | Tests | Outside hub folder | Most used |
|---|---|---|---|---|---|---|
| [a1](code/areas/a1.md) | gui/src/vm/store.tsx | 83 | 57.9 % | 20.5 % | 95.5 % | `store.tsx`, `utils.ts`, `Button.tsx` |
| [a2](code/areas/a2.md) | src/profiles.ts | 70 | 77.4 % | 38.6 % | 27.9 % | `profiles.ts`, `providers.ts`, `api.ts` |
| [a3](code/areas/a3.md) | gui/src/settings-store.ts | 36 | 59 % | 33.3 % | 66.7 % | `settings-store.ts`, `notifications.ts`, `updates.ts` |
| [a4](code/areas/a4.md) | gui/src/i18n/en/index.ts | 28 | 85.1 % | 0 % | 50 % | `index.ts`, `accounts.ts`, `common.ts` |
| [a5](code/areas/a5.md) | gui/src/vm/build.ts | 21 | 45.7 % | 38.1 % | 61.5 % | `transforms.ts`, `load.ts`, `actions.ts` |
| [a6](code/areas/a6.md) | gui/src/ipc.ts | 15 | 60.7 % | 46.7 % | 25 % | `ipc.ts`, `startup.ts`, `theme.ts` |
| [a7](code/areas/a7.md) | src/usage.ts | 12 | 52.4 % | 50 % | 16.7 % | `usage.ts`, `history.ts`, `codex-usage.ts` |
| [a8](code/areas/a8.md) | src/rebind.ts | 11 | 55 % | 63.6 % | 0 % | `keychain.ts`, `rebind.ts`, `rebind-arm.ts` |
| [a9](code/areas/a9.md) | small parts · src | 6 | 82.2 % | 50 % | 0 % | `gui-launch.ts`, `session-preview.ts`, `os-notify.ts` |
| [a10](code/areas/a10.md) | src/telemetry.ts | 6 | 60.8 % | 50 % | 0 % | `telemetry.ts`, `cache-words.ts`, `handoff.ts` |
| [a11](code/areas/a11.md) | src/token-freshen.ts | 6 | 47.3 % | 50 % | 0 % | `token-freshen.ts`, `agy-keychain.ts`, `login-keepalive.ts` |
| [a12](code/areas/a12.md) | src/tooling.ts | 6 | 69.7 % | 50 % | 0 % | `updates.ts`, `tooling.ts`, `release-notes.ts` |
| [a13](code/areas/a13.md) | gui/scripts/screenshots/capture.mjs | 5 | 75 % | 0 % | 20 % | `fixtures.mjs`, `capture.mjs`, `seed.mjs` |
| [a14](code/areas/a14.md) | src/commands/sharing.ts | 5 | 59.5 % | 40 % | 66.7 % | `share.ts`, `config-transfer.ts`, `sharing.ts` |
| a15 | gui/src/star-ask.ts | 4 | 62.7 % | 50 % | 50 % | `star-ask.ts`, `star-ask-banner.tsx`, `star-ask-banner.test.tsx` |
| a16 | small parts · scripts/pets | 3 | 50 % | 0 % | 0 % | `validate.py`, `petgen.py`, `package_pets.py` |
| a17 | src/notify.ts | 3 | 54.1 % | 66.7 % | 0 % | `notify.ts`, `daemon-context.test.ts`, `notify.test.ts` |
| a18 | small parts · gui | 2 | 0 % | 0 % | 0 % | `index.html`, `tray.html` |
| a19 | small parts · gui/src | 1 | 0 % | 0 % | 0 % | `test-setup.ts` |
| a20 | small parts · scripts | 1 | 0 % | 0 % | 0 % | `release.mjs` |
| a21 | small parts · starlight | 1 | 0 % | 0 % | 0 % | `package-lock.json` |
| a22 | small parts · starlight/screenshots | 1 | 0 % | 0 % | 0 % | `generate.mjs` |
| a23 | small parts · starlight/scripts | 1 | 0 % | 0 % | 0 % | `sync-assets.mjs` |

## Infrastructure

Files used by more than 56 other files. They are drawn apart and do not decide areas.

- `gui/package-lock.json` — used by 125 files
- `gui/src/i18n/index.ts` — used by 61 files
- `gui/src/vm/types.ts` — used by 57 files

## Surprising links

Links between two areas that are otherwise barely connected, rarest first.

- `gui/src/redesign/engines/notice-text.ts` → `gui/src/i18n/en/index.ts`
- `tests/daemon-rebind.test.ts` → `src/usage.ts`
- `gui/src/redesign/screens/logic.ts` → `gui/src/i18n/en/index.ts`
- `gui/src/redesign/screens/session-sheet.tsx` → `gui/src/i18n/en/index.ts`
- `src/agy-keychain.ts` → `src/keychain.ts`
- `src/rebind.ts` → `src/token-freshen.ts`
- `gui/src/redesign/screens/settings/general.tsx` → `gui/src/star-ask.ts`
- `gui/src/star-ask.test.ts` → `gui/src/agent-config.ts`
- `gui/src/redesign/screens/settings/general.tsx` → `gui/src/redesign/screens/star-ask-banner.tsx`
- `src/commands/system.ts` → `src/gui-launch.ts`
- `src/commands/sessions.ts` → `src/session-preview.ts`
- `src/daemon.ts` → `src/os-notify.ts`
- `gui/src/redesign/screens/settings/settings.test.tsx` → `gui/src/star-ask.ts`
- `gui/src/redesign/screens/star-ask-banner.tsx` → `gui/src/redesign/screens/tools.tsx`
- `gui/src/redesign/screens/overview.tsx` → `gui/src/redesign/screens/star-ask-banner.tsx`

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
| code | 225 |
| test | 108 |
| config | 5 |
| doc | 88 |
| infra | 3 |
| isolated | 13 |

## Guessed links

79 links were resolved by name only (no import, no type) and are not drawn by default; they are 1.4 % of all file-to-file links.

> Budget of 2000 tokens reached — cut: External dependencies. Read one with `agent-config code-graph map --section <name>`; never open `code/map.json` for it.
