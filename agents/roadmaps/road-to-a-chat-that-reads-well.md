---
complexity: standard
status: open
tree_pin: d138118
---

# Roadmap: a chat that reads well

> **Source:** owner's chat, 2026-11-05 (six requests, numbered as the owner did,
> with "terminal choice" and "controlled browser" both numbered 4 → here 4 and 5,
> the CLI-hints request → 6). Research: two delegated source reads (browser
> handling in comparable tools; markdown renderers) and two council rounds on the
> renderer, prompt and answers in
> `agents/runtime/council/responses/2026-11-05-markdown-renderer{.prompt,,-r2}.md`
> (gitignored; round 1 degraded to one seat, round 2 both seats).

## Goal

The v3 chat shows agent output the way a reader wants it: tables as tables,
diffs as diffs, long parts collapsible, all while it streams. A session can be
copied whole. The terminal the user prefers is the one agent-switch opens.
Sign-ins happen in a browser agent-switch controls, one profile per account.
What helps the user get more out of the account (clear the context, keep the
cache warm, switch before the limit) is shown in the chat, from our own numbers.

## Verified facts this roadmap builds on

| Fact | Evidence |
|---|---|
| The v3 title bar had no drag region; the 2.11 shell has one | `gui/src/v3/frame.tsx:45` vs `gui/src/redesign/Shell.tsx:59` |
| Assistant text renders as plain `whitespace-pre-wrap` | `gui/src/v3/chat.tsx:163`, plan text `:178` |
| A line-diff view exists, bound to file-edit tool results | `gui/src/v3/chat.tsx:26-37` |
| A copy button component exists | `gui/src/ui/CopyButton.tsx` |
| "Open in" knows Terminal.app only; focus knows Terminal.app + iTerm2 | `src/open-in.ts:34`, `src/focus-terminal.ts:26` |
| Sign-in browser choice goes through a `$BROWSER` wrapper (verified CC 2.1.312) | `src/browsers.ts:1-8` |
| A per-account Chromium profile dir already exists for claude.ai web | `src/commands/desktop.ts:51` (`browserDir`) |
| Google blocks OAuth in embedded webviews (`disallowed_useragent`) | developers.googleblog.com, 2021 embedded-webview notice |
| Claude Code's "/clear to save N tokens" tip is drawn in the TUI only; transcripts carry no such record | grep over all local profiles' `projects/`, 2026-11-05: 0 hits |
| Context %, prompt-cache state and limits are already in the GUI model | `gui/src/vm/types.ts:105-108`, `AsEvent` `limits` in `gui/src/v3/timeline.ts` |
| `marked` 18.1.1: MIT, zero runtime dependencies, published 2026-10-12 | `npm view marked` 2026-11-05 |

## Decisions

| ID | Decision | Why | Revisit if |
|---|---|---|---|
| D1 | Markdown: `marked` (pinned 18.1.1, private instance) as lexer only; own typed tree, own React renderer, own link policy, own `<details>` grammar | both council seats, independently (r2): grammar maintenance outweighs ~14 KB; a custom parser is not approved without evidence. Owner's rule: council favours the dependency → take it | the corpus (2.1) shows a material case marked gets wrong that we cannot fix in the adapter |
| D2 | Full-message parse per coalesced update first; no stable-prefix cache until profiling shows the need, and then only with a proof it equals the full parse | both seats: blank lines do not close containers, late reference definitions change earlier links | 2.6 measures a budget breach |
| D3 | No raw HTML, images inert, links: absolute `http(s)` only, opened through one validated opener, never by webview navigation. The shell plugin's native `open` scope stays as narrow as it is; a destination it refuses is copied instead | both seats; Tauri capabilities are a separate boundary from React escaping; widening a native scope is a security decision for the owner | a real need for `mailto:` or file links; the owner widens the scope |
| D4 | A ```` ```diff ```` fence reuses the diff view's look only; never its actions; falls back to plain code when not a valid hunk | council r1: presentation must not inherit tool authority | — |
| D5 | Usage hints come from our numbers, not from scraping the TUI | the CC tip is not in the transcript; our context/cache/limit values are | CC writes its tip into the transcript |
| D6 | Sign-in browser: an installed Chromium-family browser started with `--user-data-dir=<browserDir(provider, account)>`; Playwright with `channel: "chrome"` only as fallback; never an embedded webview | Google blocks embedded webviews; Playwright's automation flag risks the same; same dir as `agent-switch web` makes web and CLI one identity | probe 5.1 fails |

## Phase 1 — Window drag (v3)

- [x] **1.1 Title bar drags the window.** `data-tauri-drag-region` on the header
      and the search slot; logo and name pass clicks through.
      verify: `gui/src/v3/frame.test.tsx` "the title bar drags the window" (seen
      red before the fix); manual drag in the running app still owed.

## Phase 2 — Markdown in the chat

- [x] **2.1 Corpus first.** Count tables, fences (tilde, longer, in lists),
      nesting depth, reference links, `<details>`, raw HTML over local Claude and
      Codex transcripts. Transcript text is private work and this repository is
      public, so only counts are committed; the fixtures are hand-written in the
      measured shapes.
      verify: `gui/src/v3/markdown/fixtures.ts` plus the counts in
      `agents/evidence/markdown-corpus-2026-11.md` (8 416 messages, 769 files).
- [x] **2.2 Dialect spec.** Write what is rendered, what stays literal, the
      `<details>` grammar (standalone tag lines, optional first summary, nesting,
      never inside code), the URL policy, the newline policy for code.
      verify: spec section in this roadmap's evidence file, each rule linked to a
      fixture.
- [x] **2.3 Adapter + tree.** `marked` 18.1.1 private instance → typed nodes
      (paragraph, heading, list/task, table, code, diff, details, quote, hr,
      text, emphasis, strong, del, codespan, link, inert). No marked token leaves
      the adapter.
      verify: unit tests over 2.1 fixtures and the relevant CommonMark/GFM
      examples; adversarial cases (`javascript:`, `data:`, control chars, tags in
      code) render inert.
- [x] **2.4 Renderer.** Fixed React components per node, Tailwind on `ac-*`
      tokens; tables scroll horizontally; diff fence via the existing view's
      presentational part; details as native `<details>` with state kept outside
      the parse tree.
      verify: render tests; headless render of `design.html?view=markdown` in
      darcula + github-light (the recorded `v31-chat` session holds no markdown).
- [x] **2.5 Streaming.** Coalesce deltas to one parse per frame; drop results
      whose message revision is stale; open fence shows as code at once; a
      table appears once its delimiter row is valid; unmatched emphasis stays
      literal; interrupted turns keep the text as is.
      verify: every split position for short fixtures, random partitions for
      long ones: final tree equals the one-shot parse; code text byte-equal.
- [x] **2.6 Budgets and fallback.** Measure parse + commit time for a long open
      fence, a large table, deep nesting; per-message size/node limit; any
      parser error or limit breach → that message as plain text; settings flag
      to turn markdown off.
      verify: perf test with numbers in the evidence file; fallback test.
- [x] **2.7 Wire it in.** Assistant text and plan text use the renderer; user
      bubbles stay plain.
      verify: `chat.test.tsx` updated; full `vitest run` green.

## Phase 3 — Copy a whole session

- [x] **3.1 Chat.** A copy button in the chat header copies the session as
      Markdown (user/assistant turns, tool calls as one-line summaries, diffs as
      ```` ```diff ````), from the stored source text, never from rendered HTML.
      verify: unit test of the export over a recorded timeline fixture.
- [x] **3.2 Terminal.** Copy the embedded terminal's full scrollback (xterm
      buffer), ANSI stripped.
      verify: `bufferText` against a fake xterm buffer in `terminal.test.ts`;
      `CopyScrollback` in `redesign/screens/copy-scrollback.test.tsx`.

## Phase 4 — Choose the terminal

- [x] **4.1 Detection.** Installed terminals (macOS: Terminal, iTerm2, Ghostty,
      Warp, WezTerm, kitty, Alacritty; Linux: on PATH), same pattern as
      `src/browsers.ts`.
      verify: unit tests with a fake env per platform.
- [x] **4.2 Setting + use.** A setting lists only what is installed; "Open in →
      Terminal", the takeover fallback (`src/commands/takeover.ts:45`) and any
      new-window start use it. Focus stays Terminal.app/iTerm2 and says so for
      the others.
      verify: `tests/terminals.test.ts` (argv per terminal, quoting, AppleScript
      compiled with `osacompile`); live run on the owner's Mac 2026-11-05: iTerm2
      ran a command in the given folder. Terminal.app and iTerm2 are the only
      terminals installed there — Ghostty, Warp, WezTerm, kitty and Alacritty
      follow their documented CLI, not run here.

## Phase 5 — A browser agent-switch controls

- [ ] **5.1 Probe.** One Claude and one Codex sign-in through Chrome started
      with `--user-data-dir` (no automation flags): Google SSO works, the
      localhost callback completes, a second account gets its own profile.
      verify: `agents/evidence/controlled-browser-probe-2026-11.md` with CC and
      Codex versions.
      Progress 2026-11-05: `$BROWSER` hand-over (CC 2.1.316), the local
      callback, the isolated Chrome launch and Codex's fixed port are verified
      there. Open: one real sign-in with Google SSO in the isolated profile —
      it needs the owner's own Google account.
- [x] **5.2 Wrapper.** The `$BROWSER` wrapper starts the chosen Chromium-family
      browser with the account's `browserDir`; Firefox/Safari stay available as
      "system browser, no isolation".
      verify: `tests/browsers.test.ts` (script per platform, quoting, the URL
      arrives as one argument through a real shell); GUI: a switch "Own
      browser profile for this account", on by default for Chromium-family
      browsers (`accounts.test.tsx`).
- [x] **5.3 Fallback.** No Chromium-family browser installed → Playwright with
      `channel: "chrome"`, else bundled Chromium with a note that Google SSO may
      fail. Parallel Codex sign-ins (fixed port 1455) → `codex login
      --device-auth`.
      verify: `--isolated` without `--browser` takes the first installed
      Chromium-family browser, else the Playwright wrapper (`browsers.test.ts`);
      `portInUse` against a real listener; Codex's port 1455 and
      `--device-auth` checked live (evidence file). The fallback channel is
      bundled Chromium only — `channel: "chrome"` would need Chrome, which the
      first choice already uses without automation.

## Phase 6 — Hints that save the account

- [ ] **6.1 Rules.** From our values: context ≥ threshold → suggest `/clear`
      or `/compact` with the token count; warm cache about to expire → "reply
      now"; cold cache → what the next turn re-sends; account near its limit →
      switch. Thresholds named, not guessed.
      verify: pure rule tests in `gui/src/v3/` next to `timeline.ts`.
- [ ] **6.2 In the chat.** A hint row in the chat (dismissible, never
      repeating the same hint for the same state) with a one-click action
      where one exists.
      verify: render tests; screenshot.

## Open owner decisions

- None blocking. "v1" in the drag request was read as the v3 window (the 2.11
  window already drags); correct me if another window was meant.
