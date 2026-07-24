# Phase-0 spikes — road-to-session-handoff

Four falsification gates, each self-contained, each with an explicit PASS/FAIL and
an honest-null path. Run on your primary POSIX machine first (macOS or Linux).
See `agents/roadmaps/road-to-session-handoff.md` (Phase 0) for the roadmap
consequence of each gate.

## Order & invocation

```bash
./g04-process-env-recovery.sh                      # free, no accounts needed — run first
./g01-claude-move-handoff.sh  privat work          # 2 short claude turns
./g02-claude-fork-handoff.sh  privat work          # 3 short claude turns
./g03-codex-rollout-transfer.sh <src-codex-home> <tgt-codex-home>   # 2-3 codex exec turns
```

Profile layout: agent-switch v2 — `~/.agent-switch/claude/<name>/config`
(honours `AGENT_SWITCH_HOME`). For g03 pass explicit codex home dirs, e.g.
`~/.agent-switch/codex/<name>/config`, or `~/.codex` as source if you only have
the default install — the script only ever MOVES the one throwaway rollout it
created itself.

Prereqs: `jq`, `node`, both agent-switch Claude profiles logged in; for g03 two
authenticated `CODEX_HOME` dirs.

## What each script deliberately does NOT do

- No parsing of transcript/rollout content — files are opaque blobs (format is
  documented as internal and version-unstable). Only supported script interfaces
  are used: `claude -p --output-format json` (session_id, result) and `codex exec`.
- No touching of real projects — every session is created in a fresh mktemp cwd.
- No writes outside the two profile dirs you name on the command line.

## Result matrix → roadmap consequence

| Gate | PASS means | FAIL/null means |
|---|---|---|
| G0.1 | move-based `takeover` is the core primitive, Phase 2 holds | fall back to shared-history-only (M1) + spawn |
| G0.2 | `--keep-source` variant is safe via fork (M3) | takeover is move-only, no keep-source |
| G0.3 (a) | full Codex parity incl. transfer | — |
| G0.3 (b) | Codex takeover needs an index-rebuild step | — |
| G0.3 (c) | Codex ships list+spawn only; record honest-null with codex version + state-layer inventory | — |
| G0.4 | daemon can map live pids → profile+cwd without root | GUI session list limited to "recent" (mtime-based), no live detection |

## Version pinning

Record in the spike log: `claude --version`, `codex --version`, OS, and for g03
the presence of `session_index.jsonl` / `state_5.sqlite`. G0.1/G0.2 results are
only valid per Claude Code version — the roadmap's canary check (risk #1) pins
the observed header shape before building on them.

## Results log

| Gate | Date | Machine | Versions | Result |
|---|---|---|---|---|
| G0.4 | 2026-07-14 | macOS 15.7.3 | claude 2.1.209, codex 0.134.0 | PASS (env via `ps -wwE` for node children; cwd via `lsof`). Original probe against `sleep` was a false negative — Apple platform binaries block env readout; node processes (claude/codex) do not. |
| G0.1 | 2026-07-14 | macOS 15.7.3 | claude 2.1.209 | PASS — Matze1→Matze2: moved transcript resumed on target with full canary context. Move (M2) confirmed as the core takeover primitive. Harness fix: canonicalize cwd (`/var`→`/private/var`) before encoding the projects dir. |
| G0.2 | 2026-07-14 | macOS 15.7.3 | claude 2.1.209 | PASS — fork got a new session id + full context on target; source transcript byte-identical and still resumable. Keep-source (M3, `--fork-session`) is safe; takeover must delete the target's original-id copy after a successful fork. |
| G0.3 | 2026-07-14 | macOS 15.7.3 | codex-cli 0.134.0 | PASS → outcome (a) — Matze1→Matze2 (two different accounts): rollout moved into the target CODEX_HOME resumes immediately by id with full context, despite `state_5.sqlite` present in both homes. Full takeover parity, no index rebuild. Harness fixes: snapshot() tolerates a missing `sessions/` dir; both `codex exec` calls need `--skip-git-repo-check` + closed stdin on 0.134.0. |

---

# Phase-0 spikes — road-to-live-rebind (`r0*`)

Four falsification gates for the **live account rebind** roadmap
(`agents/roadmaps/road-to-live-rebind.md`, Phase 0). Same discipline as the
`g0*` gates: self-contained, explicit PASS/FAIL, honest-null path, throwaway
accounts in `mktemp` cwds. Where `g0*` moves opaque **transcripts**, `r0*` swaps
Claude Code's **credential store** — so each writes a store, always under CC's
own `proper-lockfile` directory mutex (`<config_dir>.lock`, mirrors `src/locks.ts`).

## Order & invocation

```bash
./r04-freshening.sh            privat work        # read-only decision/quarantine — run first
./r04-freshening.sh            privat work --force-quarantine   # drill the quarantine branch
./r01-live-reload-linux-win.sh privat work        # Linux/Windows: plaintext .credentials.json backend
./r02-macos-keychain-pickup.sh privat work        # macOS: hashed Keychain-entry backend
./r03-lock-protocol.sh         privat work         # lock mutex + no-clobber + move-semantics (either OS)
```

`arg1` = the profile whose (running) session is rebound — the **only** store any
script mutates. `arg2` = the account to rebind **TO** — its store is **read-only**.
Both must be logged-in agent-switch Claude profiles
(`~/.agent-switch/claude/<name>/config`, honours `AGENT_SWITCH_HOME`).

Prereqs: `jq`, `node`, `curl`, `claude`; macOS also `security`. Cost: 1–2 short
`claude -p` turns per script plus read-only OAuth `profile`/`usage` GETs.

## Safety model (throwaway accounts only)

- `arg2`'s store is **read-only** — never moved, written, or deleted.
- `arg1`'s own credential is **backed up and restored on exit** (trap), never
  destroyed — the swap is put back exactly as found even on failure/interrupt.
- The swapped-in credential is a **staging copy** the script created from
  `arg2`'s bytes; it lives in a `mktemp` dir and is removed on exit.
- **Because r01/r02 swap a COPY**, `arg2`'s token family briefly lives in two
  stores and a turn could make CC rotate it — harmless on a throwaway, and
  exactly the divergence the real feature avoids by **moving** (which `r03`
  exercises). **Never run these on a real login.**
- Every `claude` turn runs in a fresh `mktemp` cwd; no real project is touched.
- Attribution uses the **verified** read-only OAuth endpoints from `src/api.ts`
  (`/api/oauth/profile` identity, `/api/oauth/usage` windows). The falsifiable
  core needs no schema knowledge: the access **token** distinguishes the accounts,
  so "store now serves arg2 + the next turn succeeded" proves attribution;
  identity/usage are independent confirmation.

## What `r0*` deliberately does NOT do

- No refresh grant with invented constants — `r04` performs a real refresh only
  if the operator supplies `ASW_OAUTH_TOKEN_URL` + `ASW_OAUTH_CLIENT_ID`
  (the grant is Phase-1's write module); otherwise it proves the decision +
  liveness + quarantine logic against the verified profile endpoint.
- No claim that a **persistent** interactive session re-reads without restart:
  headless `claude -p` is a fresh process, so `r0*` proves the store swap takes
  effect for the **next message**. Each script prints the operator's short
  interactive confirmation for the no-restart nuance.

## Result matrix → roadmap consequence

| Gate | PASS means | FAIL / null means |
|---|---|---|
| R0.1 | Linux/Win: a `.credentials.json` swap under CC's lock is served on the next turn — rebind's live-reload holds on the file backend | file swap not adopted → rebind cannot reach a running Linux/Win session; invariant A stands, honest null |
| R0.2 | macOS: a Keychain-entry swap under CC's lock is served on the next turn; the ~30s read-cache is a persistent-process latency, non-critical in the manual flow | Keychain swap shadowed/not adopted → no macOS rebind; honest null |
| R0.3 | lock is a real mutex (a), no old-token clobber after a post-swap turn (b), move keeps one token family in one store (c) | clobber or non-mutex → the store-race is not closed; the write path is unsafe → roadmap ends with honest null |
| R0.4 | freshen decision correct (<10 min ⇒ refresh first); a dead refresh token is **quarantined**, never activated | quarantine gate does not fire on a dead token → a rebind could hand a running session a credential that dies mid-turn |

All PASS → build Phase 1. Any FAIL/null on R0.1–R0.3 → the narrowed read-only
invariant (Conflict A) stands and the roadmap ends with a documented honest null.

## Per-CC-version canary (risk #1)

Claude Code's credential storage is an **internal contract, not an API**. Before
trusting an `r0*` PASS, pin — for the installed `claude --version` — the three
things that can drift on any release, and **fail loud (never silent) on drift**:

1. **Lock protocol** — the directory-mutex path `<config_dir>.lock`, the 10 s
   staleness window, the ~5 s holder touch (`src/locks.ts`).
2. **Keychain naming** — `Claude Code-credentials-<sha256(NFC(dir))[:8]>`, hashing
   the raw unresolved dir string (`src/keychain.ts` `serviceNameFor()`).
3. **Cache TTL** — the ~30 s macOS Keychain read-cache that sets the persistent-
   session pickup latency.

If any of the three no longer matches what the spike observed, the gate's PASS is
**void for that CC version** — re-run before building on it.

## Version pinning

Record in the results log: `claude --version`, OS, credential backend
(file vs Keychain), and the observed lock/keychain/cache facts above.
