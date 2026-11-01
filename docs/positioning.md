# Positioning — the words every agent-switch text uses

Internal source for the README, the docs site, the GitHub description, release
notes and any post. Write from this file. Do not re-derive the message per
page. Every claim here names the code that backs it. If the code changes, this
file changes in the same PR.

## Who it is for

Developers who pay for **more than one AI coding subscription**: a work and a
personal Claude plan, several Claude Max/Pro seats, Claude plus ChatGPT (Codex),
Antigravity on top.

## The four pains, and the one-line answers

| They say | agent-switch answers |
|---|---|
| "I keep logging out and back in to switch accounts." | Every account stays signed in side by side. Switching never logs anyone out. |
| "One account hits its limit mid-task while the other resets unused." | Each new session starts on the account that would otherwise waste the most of its quota at its next reset. |
| "I never know which account has what left." | The menu-bar app shows every account's 5-hour and weekly meters, live. |
| "Client work ends up on my personal account." | Pin a folder to an account once. Every session started in it uses that account. |

## Promise

**Tagline (hero, GitHub description):**
All your AI coding accounts, signed in side by side — and every session on the
one with the most left.

**One-liner (npm description, ≤ 120 characters):**
Claude Code, Codex and Antigravity accounts signed in side by side; each session
starts on the one with the most left.

## Three pillars and their proof

1. **Never log in twice.**
   - Each account is its own profile with its own config folder:
     `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, or `HOME` for Antigravity
     (`src/providers.ts`).
   - Switching changes which folder the next start uses. It never copies or
     swaps a login (`src/profiles.ts`).
   - `import` turns the login you already have into a profile without signing
     in again. That profile still shares its login with the default install,
     so it is never balanced or refreshed until `agent-switch login <name>`
     gives it its own (`src/commands/profiles.ts` cmdImport and cmdLogin,
     `src/dir-resolve.ts`). The quick start therefore leads with `add`.
   - With the background service, Claude logins are kept fresh without spending
     quota (`src/token-freshen.ts`, ADR-004, on by default).
2. **Never waste a paid limit.**
   - With no folder rule, a start is balanced across your accounts. It goes to
     the one that would lose the most of its rest at its next reset
     (`src/balance.ts`).
   - Folder rules pin a project to an account or to a pool of accounts
     (`src/dir-resolve.ts`).
   - Protection keeps a start off an account at its limit (default 98%).
   - `dir --json` and `picks` say why each start went where it went.
   - Needs fresh usage numbers (≤ 10 minutes old, `FRESH_USAGE_MS`). The
     background service refreshes every enabled account every 5 minutes
     (`src/daemon.ts` `selectPollTargets`), and every refresh in the desktop
     app counts too. Without fresh numbers, a start uses your chosen account.
3. **See everything, move anything.**
   - The desktop app (Tauri) shows meters, live sessions and context %, and
     asks you when something needs you.
   - `takeover` moves a session to another account and resumes it there.
   - `rebind` switches the account of a running Claude session (macOS), now or
     when its turn ends.

## Trust line

Your logins stay where the provider put them, and they only ever travel to the
provider they belong to. No proxy, no telemetry, no account, no server.

The complete outbound list:
- the provider's own usage endpoints (`api.anthropic.com`,
  `chatgpt.com/backend-api/wham/usage`), called with your own token;
- GitHub (release check, app download);
- npm (update check).

## Objections

| Objection | Answer |
|---|---|
| "Is this against the provider's terms?" | Every profile signs in through the provider's own login and uses the provider's own client. agent-switch does not proxy, pool free tiers, or hold logins for anyone (NON-GOALS.md). This describes the code; it is not legal advice. |
| "Will it touch my credentials?" | Only two commands ever write a credential store, both on your request and only on your machine: `import` and `rebind` (ADR-003). Everything else reads. |
| "Why not just set `CLAUDE_CONFIG_DIR` myself?" | You can. agent-switch adds the parts you would otherwise script: per-folder rules, balanced starts, usage meters, session moves, a login that stays fresh, uninstall. |
| "Why not a keychain-swapping tool like claude-swap?" | Swapping one login in and out means every other account goes stale. Here every account stays live at once. |
| "Does it switch accounts behind my back?" | Never during a session. It picks an account when a session *starts*. Near a limit it suggests; a running session moves only when you confirm. |

## Vocabulary — say this, not that

| Internal term | In user-facing text |
|---|---|
| profile | account (say "profile" only where the CLI argument is meant) |
| config-dir isolation | each account has its own folder |
| balanced plain start | balanced start: a new session goes to the account with the most to lose at its reset |
| folder rule / mapping | pin a folder to an account |
| pool | a group of accounts a folder can use |
| window (5h / 7d) | the 5-hour limit and the weekly limit |
| single-load guard | one account, one running session |
| protection | limit protection |
| autoswitch | limit suggestions (never "automatic switching") |
| rebind | switch a running session's account |
| takeover | move a session to another account |
| daemon / service | background service |
| telemetry (`src/telemetry.ts`) | context readout (it reads local session files; never "telemetry") |

## Voice

- Benefit first, mechanism second, internals last.
- One idea per sentence. Concrete numbers over adjectives.
- Say what it never does as clearly as what it does.
- No "seamless", "magic", "revolutionary", "intelligent".

## Demo storyboard

**Clip 1 — the balanced start (terminal, ≤ 20 s).** Generated from the real CLI
against a seeded, anonymized home.
1. `agent-switch list`: two Claude accounts, `work` and `personal`.
2. `agent-switch status`: work at 81% weekly with a reset in 5 days; personal
   at 34% with a reset in 14 hours.
3. `agent-switch dir --json`: picks `personal`, because 66% left that resets
   in 14 hours would be lost sooner than 19% left over 5 days.
4. `claude` starts on `personal`. The pick is in `agent-switch picks`.

**Clip 2 — the app (≤ 10 s).** The tray popover with both meters, then the
overview with "Needs you". Generated with `npm --prefix gui run screenshots`.
