# Sign-in write path — threat model (2026-11)

Step 1.1 of `agents/roadmaps/archive/road-to-the-ready-remainders.md`. Read at `6046bc2`.

## Where a sign-in writes today

| Path | Who starts it | What runs | Where the provider writes |
|---|---|---|---|
| `agent-switch add <name>` | CLI, GUI "Add account" (`gui/src/ipc.ts:694` `loginArgs`, in the embedded pty) | `claude auth login` / `codex login` / `agy` with the provider's env var set to the **profile's** config dir (`src/commands/shared.ts:155` `launch`) | the new profile |
| `agent-switch login <name>` | CLI, GUI "Sign in again" (`gui/src/ipc.ts:701` `reloginArgs`) | same | the **existing** profile |

What the provider writes, per provider:

- **Claude** — `.claude.json` `oauthAccount` (email, `organizationUuid`; no secret)
  and the OAuth credential: macOS Keychain entry whose service name hashes the
  exact `CLAUDE_CONFIG_DIR` string (`src/keychain.ts`), else `.credentials.json`.
- **Codex** — `auth.json` under `CODEX_HOME` (tokens + `id_token` with the email).
- **Antigravity** — no separate login command; `agy` signs in inside a full
  session, token in a keychain under the profile `HOME` (`src/agy-keychain.ts`).

## Which identity check runs, and when

- CLI `login` (`src/commands/profiles.ts:204-222`): only "is it signed in at all"
  (`authStatusFor`). No comparison with the account the profile belonged to.
- GUI reauth (`gui/src/redesign/screens/reauth.tsx:141-156`): reads the identity
  **after** the CLI returned and compares it with the one before. On a mismatch
  the dialog says "this account's folder now holds it" — the wrong account is
  already written.

So the check exists only in the GUI and only after the write: the defect the
roadmap names.

## Abuse and failure cases

| # | Case | Effect today |
|---|---|---|
| A1 | The browser is signed in to another Google account and the user picks it | profile "work" now holds the personal account; starts, balancing, bindings, protection and labels act on the wrong account |
| A2 | Same email, other organization (multi-org) | usage and data go to the other organization; the email alone looks right |
| A3 | Provider exits half-way | a partial or empty credential in the profile |
| A4 | A staging copy is left behind holding a live credential | a second readable copy of a token outside the profile |
| A5 | Two sign-ins on one profile at once | the later commit wins silently |
| A6 | On macOS the staging sign-in leaves a Keychain entry for the staging path | an orphaned credential in the user's login keychain |
| A7 | Antigravity signs in inside a session under the profile HOME | cannot be staged without moving its keychain; same exposure as A1 |

## Controls 1.2 ships

- Sign in into a **staging** config dir (`<root>/staging/<provider>-<name>-<pid>`,
  mode 0700), never into the profile (A1, A2, A3).
- Expected identity = the profile's identity before the sign-in (email, and for
  Claude also `organizationUuid`). A profile without one (first sign-in) accepts
  any account.
- Mismatch, unfinished sign-in or any error → the staging dir and its Keychain
  entry are removed; the profile is not touched (D2: nothing written, no rollback).
- Match → commit under the profile's lock (A5): Claude through the sanctioned
  seed path of `import` (`clearStale` + `.credentials.json`, ADR-003) plus the
  `oauthAccount` block; Codex by an atomic rename of `auth.json`.
- Staging is removed on every exit path (A4, A6).
- A distinct exit code for "wrong account" so the GUI says "nothing was saved"
  instead of "the folder now holds it".
- Antigravity (A7): not staged. Its residual is recorded here, not hidden; the
  CLI compares afterwards and says so.

## Negative tests 1.2 must ship

| Test | Expectation |
|---|---|
| N1 Claude, other email | exit = wrong-account code; profile `.claude.json` and `.credentials.json` byte-identical; staging gone |
| N2 Claude, same email, other org | same as N1 |
| N3 Codex, other email | profile `auth.json` byte-identical; staging gone |
| N4 right account | credential written into the profile once; staging gone |
| N5 unfinished sign-in | profile untouched; staging gone |
| N6 first sign-in (no expected identity) | committed |
