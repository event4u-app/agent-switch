# ADOPTED.md — mechanisms taken from realiti4/claude-swap

Analysis basis: fresh clone, HEAD `be77bc2` (merge of PR #126), ~13.7k LOC
Python across 27 modules + 35k LOC total incl. tests. claude-swap is a
**snapshot architecture** (swaps the active credential in place per account);
agent-switch is a **CLAUDE_CONFIG_DIR isolation architecture** (every profile is a
live login). Most of claude-swap's complexity exists to keep snapshots from
going stale — machinery we structurally don't need. What transfers is its
verified knowledge of Claude Code's internal contracts, plus three UX
features. Everything below carries the source file it was verified against.

## Adopted

### 1. Hashed keychain service derivation → `src/keychain.ts`
`session.py:147-156`: with `CLAUDE_CONFIG_DIR` set, Claude Code derives its
macOS keychain service as `"Claude Code-credentials-" +
sha256(NFC(raw_env_value)).hex[:8]` — the *unresolved* string, NFC-normalized
(claude-code src: `envUtils.ts` / `macOsKeychainHelpers.ts` per their
comment). Consequences implemented:
- `agent-switch remove` now deletes the profile's actual keychain entry (before
  dir removal — `session.py:556-558`: the hashed name is unrecoverable once
  the path is forgotten). Replaces our previous vague "check Keychain Access"
  hint.
- `agent-switch status` can read each profile's live credential.
- `profiles.ts` documents that `configDir()` is the single source of the
  exact string exported — a resolved/realpath variant would hash differently.

**Contract risk**: internal to Claude Code, not a public API. All keychain
code degrades gracefully (read → file fallback; delete → best-effort).

### 2. Login-free `import` via credential seeding → `cmdImport`
`session.py:474-546` (bootstrap): seed a profile with a plaintext
`.credentials.json`; Claude Code migrates it into the profile's hashed
keychain entry on first write. This is deliberately the *supported* seeding
path — writing the hashed entry ourselves would couple to internal storage
format where a mismatch is a hard "logged out" failure. Three load-bearing
details adopted verbatim:
- Delete any stale hashed keychain entry **before** seeding — Claude reads
  the keychain before the file, so a stale entry shadows the seed
  (`session.py:478-481`).
- Set `hasCompletedOnboarding: true` and a `theme` in `.claude.json` — claude
  shows onboarding when `!config.theme || !config.hasCompletedOnboarding`
  (`session.py:531-540`).
- Read the source credential **under Claude Code's own locks** (see 3.).

Effect: `agent-switch import` migrates the existing default login with **zero**
re-login (previously we required one /login). Divergence from claude-swap:
we do **not** refresh the token during import. They must (their snapshots
age); for us the profile is live and refreshes itself, and an eager refresh
would kill the default install's copy instantly instead of on first use. The
shared-lineage consequence is printed as a warning instead.

### 3. Cooperation with Claude Code's proper-lockfile locks → `src/locks.ts`
`claude_locks.py:1-50`: Claude Code guards token refresh with npm
`proper-lockfile` on the config home (`~/.claude.lock`) and `~/.claude.json`
writes on the config file (`~/.claude.json.lock`). Protocol: lock artifact is
a *directory*, mkdir atomicity is the mutex, stale after 10s of untouched
mtime, holders touch every 5s, claude retries 5× with 1–2s jitter. Without
this, an `import` landing inside a refresh window (read → network → save,
all under the lock) can capture a pre-rotation refresh token that is dead the
moment the refresh saves. Ported as `withProperLock()` (touch interval 3s for
margin, 9s bounded wait, stale takeover) and used around the `import` reads.

### 4. Settings sharing via write-through symlinks → `src/share.ts`
`session.py:17-35, SHARED_ITEMS/HISTORY_ITEMS/SHARE_MANIFEST`: symlink
`settings.json`, `keybindings.json`, `CLAUDE.md`, `skills/`, `commands/`,
`agents/` from one source into each profile — Claude Code's settings writer
detects symlinks and writes through, so `/config` changes in any profile land
in the source for all. Account-/instance-scoped items (`.claude.json`,
`.credentials.json`, `plugins/`, `sessions/`, `ide/`, `statsig/`) are
deliberately excluded. History (`projects/`, `history.jsonl`) is a separate
opt-in (`--history`, POSIX-only — copies would fork history, not share it). A
manifest records what agent-switch created so `share off` never touches user data.
For an agent-config setup this is the payoff feature: one skills/commands/
agents tree across all three accounts.

### 5. Directory → profile mappings → `src/mappings.ts`
`mappings.py` (their PR #71): map normalized absolute paths to accounts;
resolve the CWD to the nearest mapped ancestor. Wired into `agent-switch dir`, so
the existing `claude()` shell wrapper auto-selects the account per repository
with **zero** shell changes. Precedence: mapping > active profile > default.
Divergence: we key on profile names (stable directories) instead of their
(email, orgUuid) composite — their indirection exists because slot numbers
get reused, which our model doesn't have.

### 6. OAuth read endpoints for identity + usage → `src/api.ts`, `agent-switch status`
`oauth.py:191-210, 323-334`: `GET api.anthropic.com/api/oauth/profile` and
`/api/oauth/usage`, Bearer access token, header `anthropic-beta:
oauth-2025-04-20`. Used read-only for `agent-switch status` (org + 5h/7d windows
per profile). Defensive parsing; unknown shapes degrade to a one-line note.

### 7. Live-session detection → `src/api.ts`, `list`/`remove`
`process_detection.py:1-6`: Claude Code writes session PID files to
`<config>/sessions/{pid}.json` and IDE lockfiles to `<config>/ide/{port}.lock`
— the same mechanism it uses internally. `agent-switch list` shows live-session
counts; `remove` refuses (without `--force`) while sessions run.

## Deliberately not adopted

- **`autoswitch.py` (1.2k LOC) + `poll_policy.py` + `usage_store.py`** — the
  auto-rotation engine: watch quota, switch to the account with the most
  headroom before hitting the limit, `--strategy best/next-available`,
  hysteresis, cooldowns, adaptive polling. Technically the most sophisticated
  code in the repo, and precisely the part that exists to route around rate
  limits by pooling subscriptions — a usage-policy conflict, same verdict as
  the G0DM0D3 analysis: neutral mechanisms only. Displaying your own usage
  (`status`) stays; automated failover between accounts does not.
- **Token refresh grant** (`oauth.py:99-155`, `platform.claude.com/v1/oauth/
  token` + public client_id) — required in a snapshot architecture to heal
  aging snapshots; in ours it would rotate tokens underneath live sessions
  for no benefit. Not porting keeps us off Claude Code's write paths
  entirely (reads only, and only under its locks).
- **Switch machinery** (`switcher.py`, 4k LOC), **migrations**, **transfer**
  (cross-machine plaintext credential envelopes), **TUI/menubar**,
  **update_check** — snapshot-architecture scaffolding or scope we don't
  want.
- **`credential_fingerprint`** (`oauth.py:43-59`, sha256 of the refresh token
  as lineage identity) — elegant, noted for later (would let `list` flag two
  profiles holding the same account), but no current consumer. Parked.

## Open verification points (not testable in this sandbox)

1. Keychain service hash: contract test against a real Claude Code install
   (create profile, log in, `security find-generic-password -s "Claude
   Code-credentials-<hash>"` must hit). claude-swap carries a dedicated
   contract test for this (`tests/test_macos_keychain_contract.py`) — worth
   mirroring in CI on a macOS runner.
2. Usage API response shape: `formatUsage` expects `five_hour/seven_day`
   with `utilization` + `resets_at`; verified only against claude-swap's
   parser, not a live response.
3. Write-through symlink behavior of Claude Code's settings writer on
   current versions (claude-swap asserts it; we inherit the claim).
