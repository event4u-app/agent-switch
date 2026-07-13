---
complexity: lightweight
parent_roadmap: road-to-agent-switch-core
execution:
  mode: autonomous
---

# Roadmap: agent-switch review round-2 fixes (argv blocker, migration, CLI tests, hardening)

> Close the round-2 review findings against `main@a9a8fce`: a destructive argv
> parser bug, a migration credential-freshness bug, the untested CLI layer, and
> six hardening minors — all with tests, no behavior change beyond the fixes.

## Goal

Fix the two correctness defects that bite real users (F1 argv value-leak → wrong
/ destructive command target; F2 migration can log a profile out), close the
CLI-layer test gap that let the blocker ship (F3), and land the six hardening
minors. Input is the two-round expert review in `agents/tmp/feedback-1.txt`
(round 2 is authoritative — round 1's findings were already implemented).

## Context

- Reviewed twice against the live merged code; every finding verified, the
  destructive one by repro. No AI council members are configured locally, so
  the review file itself is the expert input — not a re-run council.
- Scope is bug-fix + test + hardening only. No new features; the anti-rotation
  lock and zero-dep-CLI invariants stay untouched.

## Phase 1: Argv parser — fix the destructive value-leak (F1)

- [x] **Step 1:** Extract `parseArgs(argv) → { cmd, providerId, positional,
      flags }` in `index.ts`, exported for tests. It must strip value-flags
      (`--provider`, `--shell`, `--source`) **and their values** before
      collecting positionals (the current `rest.filter(a => !a.startsWith("--"))`
      leaves the value in `positional`), and collect boolean flags
      (`--json`, `--force`, `--history`). `run` keeps its passthrough parser.
- [x] **Step 2:** Route every command through `parseArgs` so the documented
      flag-first form (`add [--provider P] <name>`) targets the right profile.
      <!-- verify: npm test -->

**Exit criteria:** `add --provider codex neu` creates a `codex` profile named
`neu` (not `codex`); `remove --provider codex opfer --force` targets
`codex/opfer`. `npm test` green.
**Rollback:** revert `index.ts`.

## Phase 2: Migration credential freshness (F2)

- [x] **Step 1:** In `migrateLegacyLayout` (`profiles.ts`), always write the
      captured `cred` (keychain-first = freshest known) into the new profile's
      `.credentials.json`, overwriting any stale file relic `cpSync` copied —
      drop the `if (!fs.existsSync(credFile))` guard. Otherwise a v1 profile
      with an old file credential keeps the dead token after the old keychain
      entry is deleted → logged out.
- [x] **Step 2:** Migration regression test: a profile whose keychain cred is
      fresher than a copied file relic ends up with the fresh cred at the new
      path. <!-- verify: npm test -->

**Exit criteria:** the fresher keychain credential wins the migration; test
covers the stale-file-relic case.
**Rollback:** revert the one-line guard change.

## Phase 3: CLI-layer test strategy (F3)

- [x] **Step 1:** Unit-test `parseArgs` for both flag positions (flag before
      and after the positional) across `add/use/remove/map/status/list`, incl.
      the boolean flags and the invalid-provider error path.
- [x] **Step 2:** End-to-end smokes over the built CLI (`node dist/index.js`
      against a temp `AGENT_SWITCH_HOME`, mirroring `integration.test.ts`):
      assert `add`/`use`/`remove` with `--provider` in flag-first form target
      the correct profile — explicitly the destructive `remove` repro (F1's
      worst case) no longer deletes the wrong profile. <!-- verify: npm test -->

**Exit criteria:** the parser + the destructive-remove repro are covered by
tests that would have caught F1.
**Rollback:** remove the new test files.

## Phase 4: Hardening minors (a–f)

- [x] **Step 1 (a):** Drop EOL Node 18 — `engines` `>=20`, CI matrix `[20, 22]`.
      <!-- verify: npm test -->
- [x] **Step 2 (b):** Stop the per-launch migration tax: gate
      `migrateLegacyLayout` behind a one-time layout marker (write it after a
      pass; return early when present) and exclude the read-only hot-path
      `dir` command from triggering it.
- [x] **Step 3 (c):** `writeDaemonState` `mkdirSync` with `mode: 0o700`
      (consistent with `ensureRoot`).
- [x] **Step 4 (d):** Reword the `api.ts` User-Agent comment — the
      "(extension-verified)" claim is unverified; state it as good practice,
      not a verified fact.
- [x] **Step 5 (e):** Add a `timeout` to the `doctor` binary `spawnSync` probes
      so a hung binary can't hang the doctor.
- [x] **Step 6 (f):** Gate `remove`'s keychain-entry deletion behind
      `providerId === "claude"` (codex/gemini are file-based; computing a Claude
      hash for them is a conceptual no-op). <!-- verify: npm test -->

**Exit criteria:** `npm test` green; a Linux + node-20/22 container run stays
green; `doctor` still exits 0 on a healthy setup.
**Rollback:** revert per step.

## Acceptance Criteria

- [x] F1 fixed: flag-first `--provider` targets the correct profile for every
      command; destructive `remove` repro covered by a test.
- [x] F2 fixed: migration always seeds the freshest credential; regression test.
- [x] F3 addressed: `parseArgs` extracted + unit-tested (both positions) + CLI
      e2e smokes exist.
- [x] Minors a–f landed.
- [x] `npm test` green (macOS + Linux node 20/22); zero-dep + anti-rotation
      invariants unchanged.

## Verification note

An independent adversarial review pass (subagent) checks the fixes against the
review file before the PR — the round-2 blocker was destructive, so the fixes
get a second set of eyes. The three `AGENT_SWITCH_CONTRACT_TESTS` gated tests
(keychain hash, usage shape, #40857) still need a one-off local mac run — out of
scope here (needs a real login).
