# Agent Switch v3 — UI specification (design proposal)

Status: **proposal**, design only. Nothing here is wired to the engine. The
boards in `gui/src/v3/` render with demo data (`gui/src/v3/data.ts`). This file
says what every element is for, how it looks and how it behaves, so a local
agent can build the real app from it. Where the reference code and this text
disagree, this text wins. Report the conflict.

Roadmap context: `agents/roadmaps/archive/road-to-agent-switch-v3-central.md`
(v3.0 "Central"). The parked follow-ups are v3.1 "Client" (chat view and
review) and v3.2 "Reach" (more agents, remote). Boards that belong to v3.1 or
v3.2 are marked as such below. They are proposals too.

---

## 0. How to look at the reference

```bash
cd gui
npm ci
npx vite --port 1431            # then open http://localhost:1431/v3.html?view=main&theme=darcula
npx vite build -c vite.v3embed.config.ts   # IIFE for the design canvas → dist-v3embed/
npx vitest run src/v3           # theme registry + contrast tests
```

`view` is any id from §12, `theme` is any theme id from §2, and `accent` is
`theme` or `agent-switch`.

| File | Holds |
|---|---|
| `v3/kit.tsx` | Shared primitives: `Chip`, `Marker`, `AccountMark`, `Act`, `PageHeader`, `BatchBar`, `Later`, `Disclosure`, `Label`, `pct`. It also holds the corner and state rules in a comment. |
| `v3/frame.tsx` | Window frame: title bar, stripes, Sessions window, Limits strip, tab strip, session bar, terminal view, blocker strip, external-terminal body, system banner, `Shell`. |
| `v3/limits.tsx` | Everything about limits: bars, rows, popover, pace line. |
| `v3/panels.tsx` | Right tool windows: Summary, Changes, Children. |
| `v3/menus.tsx` | `Menu`, Open-in split button and menus. |
| `v3/dialogs.tsx` | New session, near-limit decision, End, Resume, Inbox popover, Model popover. |
| `v3/pages.tsx` | Accounts, All sessions, Library (page tabs). |
| `v3/states.tsx` | ⌘K palette, ⌃Tab switcher, first run, Tools page, hover peek. |
| `v3/rest.tsx` | Tray, "where every 2.11 function went" check. |
| `v3/appearance.tsx` | Settings frame, Appearance, theme gallery. |
| `v3/settings3.tsx` | Settings › Open in, Agents (v3.2), Remote (v3.2). |
| `v3/v31.tsx` | Chat view and Review (v3.1). |
| `v3/themes/*` | Theme registry, token resolver with contrast floors, tests. |
| `v3/views.tsx` | View id → board. |

Shared changes outside `v3/`, which the main GUI gets too:
- `ui/Segmented.tsx`: the selected segment uses a raise fill instead of the accent outline.
- `ui/RowMenu.tsx`, `ui/Select.tsx`, `ui/Toaster.tsx`: corners go to 12 px (floating layers).
- `ui/AcRoot.tsx`: takes a `style` prop so theme variables sit on the root.

---

## 1. Principles (binding for every screen)

1. **Focus first.** There is one window, and the terminal is the default view. Nothing moves, opens or switches on its own.
2. **Never automatic.** Account switching is suggested, never done by itself. Every switch is a click by the user.
3. **Approvals stay real.** An approval in the app is the same rule as the terminal prompt. It is never bypassed and permission modes are never loosened.
4. **No guessed relations.** Every parent/child relation says where it comes from (hook, lineage, git, GitHub, host, counted). If it cannot be proven, the UI says "relation unknown". It never infers.
5. **Hosting is opt-in per start.** Sessions run in the user's own terminal by default. "Host in Agent Switch" is a choice in the start dialog.
6. **Every 2.11 function stays reachable.** See the map in §11.
7. **Same element, same look, same behaviour, everywhere.** If a pattern changes in one place, it changes in all places.
8. **Say it in words.** A mark that needs a legend gets words next to it (see the limits pace line), or it goes.
9. **One filled button per surface.** Only the primary action of a surface is filled. The window primary is "Start session".
10. **Exceptions only.** Rows show numbers and state words only when something is not OK.

---

## 2. Themes and tokens

All colours come from `--ac-*` tokens set on the `.as-ac` root by
`resolveTheme(def, accent)` (`themes/resolve.ts`). Components never use raw
colours, except the account identity colours.

Surface tokens and where they are used:

| Token | Used for |
|---|---|
| `--ac-bg` | Workbench, terminal page, inputs |
| `--ac-panel` | Tool windows, dialogs, menus, table cards |
| `--ac-rail` | Title bar, stripes, tab strip, dialog footers |
| `--ac-raise` | Hover, selected rows, meters' track |
| `--ac-line` / `--ac-line2` | Dividers / borders of controls |

Text tokens: `--ac-text` (primary), `--ac-soft`, `--ac-muted`, `--ac-faint`.

Signal tokens: `--ac-brand`, `--ac-ok`, `--ac-warn`, `--ac-alert`,
`--ac-info` and `--ac-violet`. Each has `-text`, `-tint` and (brand, violet)
`-line` variants.

Terminal tokens: `--as-term-bg`, `--as-term-fg`, `--as-ansi-0…15`.

Diff tokens: `--as-diff-add`, `--as-diff-del`, `--as-diff-add-line`, `--as-diff-del-line`.

The 18 themes, in this order: darcula (default for new installs),
jetbrains-dark, jetbrains-light, agent-switch-dark, agent-switch-light,
one-dark-pro, dracula, github-dark, github-light, tokyo-night,
catppuccin-mocha, catppuccin-latte, nord, solarized-dark, solarized-light,
github-dark-hc, github-light-hc, github-dark-colorblind.

Rules:
- **Contrast floors, enforced by the resolver.**
  - Primary text is ≥ 6:1.
  - Body, muted and faint text are ≥ 4.5:1 against bg, panel, rail and raise.
  - Text on the brand fill is ≥ 4.5:1.
  - Terminal ANSI colours are ≥ 4.5:1 on the terminal background (the same rule as xterm `minimumContrastRatio`).
  - A palette colour that misses is shifted just enough. Nothing else changes.
- **Accent.** Either the theme's own (default) or "Agent Switch" orange (`#ff8c2a` dark / `#f47a12` light).
- **Migration from 2.11.** The old `agent-switch-theme` (light/dark/system) keeps its mode and gets the Agent Switch palette, so an update changes nothing visible. New installs get Darcula.
- **Terminal colours.** "Terminal uses the theme's colours" is on by default. Off means the agent's own ANSI colours on the theme background.

---

## 3. Visual grammar

### 3.1 Corners — one scale

| Radius | Applies to |
|---|---|
| 0 | Window regions that tile edge to edge: title bar, stripes, tool windows, tab strip, session bar, terminal area |
| 4 px (`rounded`) | Small marks: chips, kbd, checkboxes, app monograms, tags |
| 6 px (`rounded-md`) | Everything you click: buttons, rows, tabs (top corners), inputs, menu items, segmented controls, the CLI boxes in the terminal |
| 10 px | Containers inside a page: cards, tables, info boxes, batch bar, chat tool cards, composer |
| 12 px (`rounded-xl`) | Floating layers: menus, popovers, dialogs, tray, palette |
| pill | Only state dots, meters (limit bars) and the account tick |

### 3.2 State language — one meaning per mark

| Meaning | Look | Where |
|---|---|---|
| Hover / keyboard cursor | raise fill only, no frame | rows, menu items, palette rows, chips |
| **Where you are** (current item) | **Marker**: raise fill plus a frame. The frame is a 1 px `--ac-line` border around the 6 px rounded item, with the **leading edge in the accent, 2 px**, following the rounded corners. | active session row, active stripe button, ⌃Tab current row, settings nav, review file list |
| **Active tab** | The same frame turned up. The tab has rounded top corners (6 px), 1 px side lines and a 2 px accent **top** edge that runs round the corners. It is open at the bottom and joins the content below (−1 px overlap over the strip's bottom border). Inactive tabs have the same shape with a transparent border; on hover they get a raise fill. | session tabs and page tabs |
| Focused attention item | Marker with a **warn** leading edge, and a 2 px accent focus ring around its verb button | Needs-you row under ⌘J, first inbox item |
| Chosen option in a list | Check mark (accent), no fill | model list, editor submenu, menu items with `checked` |
| Chosen option in a segmented control | raise fill, primary text, no accent | Terminal/Chat, Accounts/Usage history, Dark/Light/Sync, Thinking levels, filters |
| Radio card choice | accent outline plus accent tint, filled radio dot | "Where it runs", decision sheet "How" |
| Checkbox | 4 px square; checked = accent fill | multi-select, "In a new worktree" |

The Marker never uses inset shadows or a detached bar. One component
(`Marker` in `kit.tsx`) draws it everywhere. The tab draws the same frame
with its own borders (`TAB` / `TAB_ON` in `frame.tsx`).

### 3.3 Dots are state, ticks are identity

- **State dot** (`StateDot` → `ui/SessionStateIcon`):

  | State | Look |
  |---|---|
  | working | green filled dot, pulses (no pulse with reduced motion) |
  | needs-you | amber filled dot |
  | waiting | muted ring |
  | idle | faint ring |
  | done | faint filled dot |
  | parked | pause glyph |
  | auth-paused | amber pause glyph |
  | pause-requested | amber ring |

  A dot never means anything else.
- **Account identity** (`AccountMark`) is a 3×12 px tick in the account colour: teal, pink, purple and so on from `identityColor`. It is never a dot. It appears before an account name everywhere: session bar, limits popover, tables, dialogs, switcher, library rows.
- **The amber dot at a stripe button's corner** means "something in there needs you" (only shown while that window is hidden).

### 3.4 Chips

There are three kinds only (`Chip`, h 20, 4 px):

| Kind | Look | For |
|---|---|---|
| `status` | tinted fill | exceptions: "Near limit", "needs you" |
| `meta` | outlined | facts: "Default", "next in work", "Sign-in needed", "up to date" |
| `tag` | plain raise | user labels, filters |

Session-bar chips are a separate control (h 28, they open a popover; see §6.2).

### 3.5 Buttons (`Act`, `Button`)

| Kind | Look | Rule |
|---|---|---|
| `primary` | filled accent | One per surface: "Start session" in the chrome, the confirming button of a dialog |
| `accent` | outline in accent text | The suggested next action inside a surface: Needs-you verb on the top or focused item, "Send to agent", "Focus terminal", "Review changes", "Sign in" |
| `secondary` | neutral outline | Other actions |
| `ghost` | text only | Low-weight actions, the verb on non-top Needs-you rows |
| `danger` | alert | Destructive: "End…", "End session", "Deny", "Discard" |

A keyboard hint sits inside the button in mono at 70 % opacity (`⌘↵`).

### 3.6 Text and numbers

- UI font: the main GUI sans. Code, paths, branches and percentages are in `font-ac-mono`.
- Sizes:

  | Size | Use |
  |---|---|
  | 20 px | Page title |
  | 16 px | Dialog title |
  | 13 px | Body |
  | 12–12.5 px | Rows |
  | 11 px | Meta |
  | 10.5 px | Hints |

- One format everywhere:
  - Percent: `94%`.
  - Durations: `5h`, `1h 18m`, `2d 5h`.
  - Reset: `↻ 1h 18m`.
  - Age: `14m old`, `checked 1m ago`.
- No roadmap or version labels inside the working UI.

---

## 4. The window frame

```
┌ Title bar 44 ───────────────────────────────────────────────────────────────┐
│ ●●●  [logo] Agent Switch      [ ⌕ Go to session, account, … ⌘K ]   (pill) [Start session] ⚙ │
├──┬──────────────────┬──────────────────────────────────────────┬──────────┬──┤
│L │ Sessions window  │ Tab strip 36                             │ Right    │R │
│  │ 300              ├──────────────────────────────────────────┤ tool     │  │
│s │                  │ Session bar 40                           │ window   │s │
│t │                  ├──────────────────────────────────────────┤ 340      │t │
│r │                  │ (blocker strip, only when needed)        │ (hidden  │r │
│i │                  ├──────────────────────────────────────────┤ by       │i │
│p │                  │ Terminal (default) / Chat / page body    │ default) │p │
│e │                  │                                          │          │e │
│44│ Limits strip     │                                          │          │44│
└──┴──────────────────┴──────────────────────────────────────────┴──────────┴──┘
```

Dividers are full-height 1 px `--ac-line`. Tone order, from outside in: rail
(chrome and stripes), then panel (tool windows), then bg (workbench).

### 4.1 Title bar (h 44, rail)

- Left padding 84 px for the macOS traffic lights. Then the logo and "Agent Switch".
- **Search field** (centre, w 420, h 28): "Go to session, account, branch, PR, or run a command…" with `⌘K`. Clicking it opens the palette (§7.1).
- **"Engine stopped"** (alert tint, only when the engine is down). Clicking it shows the restart banner.
- **Inbox pill** `⊡ N`: **only visible when the Sessions window is hidden** (focus mode). Otherwise the Needs-you zone is already on screen.
  - It is amber tint normally, and alert tint while any CI is failing.
  - The pressed state adds a warn border.
  - Clicking it opens the inbox popover (§7.4). Tooltip: "Needs you · ⌘J jumps to the next one".
- **Start session** is the only filled button in the chrome. It opens New session (§8.1). Shortcut ⌘N.
- **Settings** gear (⌘,) opens the Settings page tab.

### 4.2 Stripes (w 44, rail, JetBrains style)

The buttons are 36×36 with an 18 px icon, a tooltip with the shortcut and `aria-pressed`.

| Side | Button | Opens | Notes |
|---|---|---|---|
| left | Sessions `⌘B` | the Sessions tool window | Click while active → hide (focus mode). Amber corner dot when hidden and something needs you. |
| left | Library | Library page tab | |
| left | Accounts | Accounts page tab | |
| left | Tools | Tools page tab | |
| right | Summary `⌘I` | Summary tool window | Amber corner dot when the active session has a blocker and Summary is closed. |
| right | Changes | Changes tool window | |
| right | Children | Children tool window | |

The active button has the Marker (§3.2). Only one right window is open at a
time. Clicking the active one closes it. The right window is closed by default.

---

## 5. Sessions tool window (left, w 300, panel)

Header (h 36): "Sessions", then `+` (New session ⌘N) and `⋯`. The `⋯` menu
holds: Select (multi-select), Group by project, Density (compact /
comfortable), Show pinned only.

The body scrolls as one list with sticky zone heads (h 32, 11 px semibold
soft title and a muted count). It has three zones, top to bottom.

### 5.1 Needs you (zone 1)

- **What lands here** is one queue for everything that waits for the user, ordered by urgency:
  1. Approvals (`Hand`)
  2. Questions (`MessageCircleQuestion`)
  3. Limit decisions (`TriangleAlert`)
  4. Failing CI (`CircleX`)
  5. Sign-ins (`LogIn`)
  6. Updates (`Download`)

  Warn-toned icons for 1–4, muted icons for 5–6.
- The head shows "Needs you N" with a muted `⌘J` hint on the right.
- **Row (`NeedRow`)**: one line, h 24.
  - Layout: icon · **who** (primary text, a session or account name) · **what** (muted, a short verb phrase) · **one verb** on the right.
  - The **top item** is open: it shows the verb as an accent button and a second line with the detail in mono, e.g. `npx vitest run src/v3`.
  - Other rows show the verb as a ghost button. Their detail is in the tooltip.
  - A **focused** item (⌘J) gets the warn Marker and a focus ring on the verb, plus a third line with its keys, e.g. "↵ once · ⇧↵ always · ⌫ deny · L later".
- **Verbs per kind:**

  | Kind | Verb | Keys |
  |---|---|---|
  | Approval | Allow | ↵ once, ⇧↵ always, ⌫ deny, L later |
  | Question | Reply | ↵ reply, Y yes, L later |
  | Limit | Decide | opens the decision sheet |
  | CI | Fix | sends to the agent |
  | Sign-in | Sign in | |
  | Update | Update | |

- **At most 3 rows**, then "N more ›", which opens the inbox popover.
- **"While you were away · N updates ›"**: after a long absence, one row on top collapses the digest (merged PRs, CI breaks, finished turns, limit resets). Clicking it opens the digest. It never adds several rows.
- **Later (L)** snoozes an item until it changes.
- The zone is hidden when the queue is empty.

### 5.2 Sessions (zone 2)

- A thin divider separates it from zone 1.
- **Order**, the same in the window and the tray:
  1. Sessions that need you
  2. CI failing
  3. Working
  4. Everything else

  Done sessions are not in this list.
- **Row (`SessionRow`)**: one line at rest, h 28.
  - Left: the **state dot**, or a checkbox while selecting.
  - Then the **title**: 13 px, soft; primary and medium when active. The tooltip holds the full title.
  - Then **one trailing slot**, by priority, showing only the first that applies:
    1. account name in amber when that account is near its limit;
    2. CI failing → red `CircleX`;
    3. merge conflict → red `TriangleAlert`;
    4. a small amber dot when a Needs-you item points at the session but its state is not already "needs-you";
    5. running subagents → `Bot` icon plus count (muted). The tooltip says e.g. "1 subagent · 1 running".
- The **active row** has the Marker and adds a second line: `account · branch · #PR` (11 px muted). Comfortable density adds the second line to every row.
- **Hover** (≈400 ms) shows the **peek card** (§7.3): the details that left the row.
- **Children** unfold under the row, indented with a 1 px guide line (`ChildLine`, h 24): state dot plus label.
  - Provenance is in the tooltip ("via hook", "via lineage", "via git", "via GitHub", "via host").
  - It is shown inline only when it matters: "relation unknown ⓘ" in warn, or "counted" in muted for children known only by count.
- **Done today N ›** is one collapsed row at the end with "Clean up" on the right. Merged sessions archive themselves after 24 h into the Library. "Clean up" removes merged worktrees (dirty ones are skipped).
- **Multi-select** (⋯ › Select; proposal: also ⇧/⌘-click) shows the compact batch bar on top of the window: × clear (Esc) · "N selected" · Pin · Archive · Clean worktrees · **End…** (danger). It is the same component as on the All sessions page, there with labels.

### 5.3 Limits strip (zone 3, pinned to the bottom)

- The head is "Limits". There is one row per account (`LimitRow`, h 24), grouped by tool (Claude first, then Codex). The bars show the account's state colour.
- **Row:** name.
  - Codex accounts add " · Codex".
  - The next account for new sessions adds a muted "→". Tooltip: "Next for new sessions".
  - Stale data adds "· 14m old" (muted), and the bar is drawn at 50 % opacity.
- Then the **numbers, only when not OK**, in the tone colour: `94% · 1h 18m`.
- Then a 64×4 px bar for the account's **tightest window** (the window nearest to running out).
- **Sign-in needed** replaces the bar with "sign in ›".
- **Colours:**

  | Colour | When |
  |---|---|
  | green | below protect − 15 |
  | amber | from protect − 15 |
  | red | from the account's protect value |
  | faint | unknown or stale |

- Hovering a row shows a tooltip with every window. **Clicking a row** opens the limits popover (§7.5) anchored to the row. The row keeps a raise fill while it is open.
- Small bars have **no pace tick** (see §7.5).

---

## 6. Workbench (centre, bg)

### 6.1 Tab strip (h 36, rail)

- **Session tabs** have a state dot, the title (truncated, min 140, max 220) and a muted mono `⌘1…⌘9`. The tooltip holds the full title and the shortcut.
- **Page tabs** (Accounts, Library, All sessions, Tools, Settings, Review) come first. They have their icon, label and a close `×`.
- The **active tab** uses the tab frame from §3.2. Inactive tabs keep the same shape and get a raise fill on hover.
- Closing a session tab does **not** end the session; it stays in the sidebar.
- ⌘1–9 jump to tabs. ⌃Tab opens the recent switcher (§7.2).

### 6.2 Session bar (h 40, panel)

From left to right:

1. **View switch** `[Terminal | Chat]` (segmented, h 28).
   - Terminal is the default.
   - It switches between turns, never mid-turn.
   - Chat is **disabled** for sessions in the user's own terminal. Tooltip: "Chat needs a session hosted in Agent Switch".
2. Divider.
3. **Account chip**: AccountMark · name · a 32×6 mini bar of the 5h window · `39%`.
   - The number is muted when OK and amber/red otherwise.
   - Click → "Move to another account…" opens the decision sheet (§8.2). It never switches directly.
4. **Model chip** (e.g. `Opus 5.5`) opens the model popover (§7.6) for the **next turn**.
5. **Thinking chip** (Brain icon plus level) opens the same popover's thinking part. The levels come from the tool itself (Codex shows its reasoning levels).
6. `ctx 58%`, muted mono: context used.
7. Spacer.
8. **Open ▾** split button (§7.7).
9. `⋯`: Rename, Pin, Move to account… (decision sheet), Detach, End… (§8.3).

Chips for a session in the user's own terminal are **locked**. The lock icon
replaces the caret, the chip is at 60 % opacity and the tooltip says why:
"Locked: change it in your terminal (/model)". Chips keep their shape when locked.

### 6.3 Blocker strip (only when needed)

- It appears under the session bar when the active session has a blocker, e.g. CI failing plus a merge conflict, **and** Summary is closed. With Summary open, the same "Next step" shows there instead, never twice.
- Layout: red `CircleX` · one or two lines of plain text explaining the problem and the fix · **one** accent action (e.g. "Send to agent") · dismiss ×.
- The right stripe's Summary button shows the amber corner dot while a blocker exists.

### 6.4 Terminal (default body)

- It is xterm.js with the theme's terminal tokens: 12.5 px mono, line height 1.5, padding 16/20.
- The CLI's own `╭─╮` boxes are drawn by xterm's custom glyphs (rounded arcs). The mock imitates them with a 6 px bordered box in ANSI 8.
- Text is never re-rendered or summarised in the terminal view. It is the real PTY.

### 6.5 Session in the user's own terminal

- A top strip: terminal icon · "Runs in **Terminal.app · tab 3** · read-only here" · accent "**Focus terminal** ⌘↵" · secondary "Take over here…".
- Below it is a read-only mirror of the terminal.
- "Take over here…" explains the consequence before it acts: the session moves into a host owned by Agent Switch.

### 6.6 System banner

A full-width alert-tint strip across the workbench for system problems,
e.g. "The engine stopped 2 min ago. Hosted sessions keep running in tmux;
Agent Switch reconnects when it is back." It has one accent action ("Restart
engine"). The terminal under it dims to 60 %.

### 6.7 Page tabs (pages share one layout)

`PageBody`: the content is centred, max width 960, padding 24/32. `PageHeader`
has an optional eyebrow, a 20 px title, a muted subline and actions on the
right. Tables are 10 px cards on panel with 11 px muted column heads.

---

## 7. Popovers and overlays (12 px, panel, shadow)

### 7.1 ⌘K palette (w 640, opens 72 px from the top, scrim behind)

- The input sits on top with scope chips "All" / "Last week".
- Results are grouped: **Sessions** (including the Library), **Branches & PRs**, **Commands**.
- Rows are h 36: icon · title · muted meta · optional kbd hint on the cursor row, e.g. "↵ Resume…" for a kept session or `⌘⇧M` for "Move session to another account…".
- The cursor row has a raise fill (hover language), not a Marker.
- Footer: `↑↓` move · `↵` open · `⌘↵` in new tab · `>` commands only.

### 7.2 ⌃Tab switcher (w 520)

- Most-recently-used sessions. Hold ⌃ and press Tab to step.
- Rows are h 44: state dot · title · second line with AccountMark · account · branch (mono) · "needs you" status chip when relevant · `⌘N` hint.
- The current pick has the **Marker**.

### 7.3 Peek card (hover on a session row, w 300)

- Title · last active.
- Then four lines:
  1. AccountMark · tool · account · model · thinking
  2. branch · `#PR state` · `N children`
  3. last output line (mono)
- One card at a time, shown after about 400 ms.

### 7.4 Inbox (from the title-bar pill, w 420)

- Head: "Needs you", the keys hint "⌘J next · ↵ do it · L later", and "All later".
- Then the full queue as `NeedRow`s. The first is focused.
- Then "Earlier today": finished items with a check, the text and a faint age. This is the 2.11 activity history.

### 7.5 Limits popover (from a Limits-strip row, w 320)

- **Head:** AccountMark · "Claude · side" · state chip ("Near limit") · "checked just now".
- **One `LimitBar` per window** (5h, week, week · Opus, …), with columns label · bar · `94%` · `↻ 1h 18m`.
  - Full-size bars show a **pace tick**: a 2 px rounded vertical tick in primary text colour at the share that **even use** would have reached by now.
  - The bar colour shows the warn threshold. There is **no separate warn line**.
- **Pace line in words**, under the bars:
  - For every window at least 10 points ahead of pace: "**5h runs ahead** · 94% used, 74% expected by now" (the name in warn text).
  - Otherwise: "Every window is on pace".
  - A one-line legend follows: "Tick = even pace · amber from 83%, red from 98%". The numbers are protect − 15 and protect.
- **Actions:** "Move its session…" (decision sheet) · "Open Accounts".

### 7.6 Model popover (w 320, under the model chip)

- "Model · next turn" (small caps), then one row per model: check · name · muted hint ("deepest · uses the most limit", "balanced", "fast · light on limits").
- The chosen model has **only the check**. Hover gets the raise fill.
- "Thinking": a segmented control with the levels the tool declares (Low / Medium / High / Max for Claude).
- Note: "Applies from the next turn."

### 7.7 Open in ▾ (split button plus menu)

- **Main part**: app monogram plus "Open". It opens the **default target** (⌘O). The tooltip names it: "Open in PhpStorm (default) · ⌘O".
- **Caret part** opens the menu (w 268):
  1. The default target, with hint "default" and key `1`.
  2. The last used target (e.g. Claude Desktop), with hint "last used" and key `2`.
  3. Divider.
  4. Submenus: **Editor** › detected editors (default checked; not installed = disabled with "not installed"), Copy path, Open PR on GitHub.
  5. **Agent app** › only the app matching the session's tool (Claude → Claude Desktop, Codex → Codex Desktop), hint "opens this project". A note says that continuing the same conversation there appears only where that app supports it.
  6. **Terminal** › focus / new here / attach tmux.
  7. **Files** › reveal / copy path.
  8. **Web** › PR / CI run (hint "PR #142").
  9. Divider, then "Configure targets…" (Settings › Open in).
- **No URL schemes.** Apps are launched with their own launcher on the worktree root.
- Apps that are not installed stay hidden in the main list.

---

## 8. Dialogs (modal, 12 px, scrim, Esc closes)

Every dialog has a kicker, a title, an optional subline and a footer in rail
tone. The footer holds Cancel (ghost) and **one** primary.

### 8.1 New session (⌘N, w 620)

- **Prefill:** everything comes from the last start in this project. "Remembered for this project" sits in the footer. ⌘↵ starts right away.
- **Title:** "Claude in ~/code/agent-switch".
- **Grid (2 columns):**
  - **Folder**: mono field, git state in the label ("main · clean"), and the checkbox "In a new worktree".
  - **Tool**: segmented Claude / Codex / Antigravity.
  - **Model**: field "Opus 5.5 · last used here".
  - **Thinking**: segmented, with the levels of the chosen tool. Label hint: "higher = slower, uses more limit".
- **Account box:**
  - "Automatic → ▍work", with the reason on the right ("most room in pool “day”").
  - All its windows as limit bars.
  - A pace estimate in words: "At today's pace: about 3h of Opus · High before the 5h window is full".
  - "Why? ›" expands the 2.11 routing lines.
  - "Choose another…" in the label.
- **Where it runs** (radio cards):
  - **Your terminal** (default): "As today: Terminal.app. Agent Switch shows it; you type there."
  - **Host in Agent Switch**: "Keeps running when the window closes; type into it here. Chat view possible."
- **Command preview ›** (collapsed): the exact command that will run.
- **The primary names the outcome:** "▶ Start in Terminal.app ⌘↵". Proposal: "Start here" when hosted.

### 8.2 Near-limit decision sheet (w 580)

- **Kicker** "Near limit". **Title** "side is at 94% of its 5h window". **Subline** "Resets in 1h 18m. 1 session runs on it. Nothing changes until you choose."
- **Sessions on side:** one row per session: checkbox · state · title · model · "→" · target account picker (AccountMark plus name ▾).
- **How** (radio cards):
  1. After this turn, continue on work (default)
  2. Switch now (rebind; checked for this Claude version, falls back safely)
  3. New session with a brief
- **Room left:** every account of that tool, with all its windows. The label shows the suggestion, e.g. "suggested: work — next in this project's pool".
- **Footer:** "Keep going on side" (ghost) and "**Continue on work**" (primary).
- Opened from: Needs-you "Decide", the session bar account chip, ⋯ › Move, the limits popover "Move its session…" and the palette.

### 8.3 End session (w 500)

- Title: "End “…”?" It lists what stops with it, e.g. a running subagent with its worktree.
- Buttons: Cancel · "Just close the tab" (keeps it running in the sidebar) · **End session** (danger).
- The transcript is kept in the vault either way.

### 8.4 Resume (from the Library, w 620)

- **Preflight checklist:** ok / warn icons with one line each.
  - Folder exists
  - Branch gone, commit still reachable
  - Main checkout not clean
  - Account ready (with numbers)
- **Suggestion in words:** "a new worktree at the session's last commit, so your open changes stay untouched".
- **How** (segmented): Continue · Fork · Other account · New with brief.
- **Command preview** (mono, copy).
- **Primary:** "▶ Resume in a new worktree".

---

## 9. Right tool windows (w 340, panel)

The header (h 36) has the title, optional aside text and "Hide ⌘I" (−).

### 9.1 Summary

1. **Next step box** (10 px card on bg): one sentence on what is next, plus **one** accent action. Only shown when there is a suggestion, e.g. "Request review", "Send to agent". It replaces the blocker strip while Summary is open.
2. **Pull request**:
   - CI icon · `#311` · "CI failing" (alert text when failing) · external link.
   - A second line: lifecycle · mergeable/conflict · review state.
   - One line per failing check.
   - With no PR: "No PR yet" and "Create PR…" (ghost).
   - Provenance tooltip on the section title: "GitHub · refreshed every 60 s while the session runs".
3. **Git**: one line: branch · worktree icon · "3 changed" (amber) or "clean" · `↑1 ↓0`. Provenance: "from the session's hooks".
4. **Limit**: only when the session's account is near its limit. The account's full limit block.
5. **More ›** (collapsed): ID (copy), Host ("tmux · …" or "your terminal"), Library ("pinned · in vault"), Children.

### 9.2 Changes

- Aside: "worktree vs HEAD". Summary line: "7 files · +363 −29".
- File rows: status letter (A green, M info) · dimmed directory plus file name in mono · `+n` · `−n`.
- Actions: "Review changes" (accent) opens the Review page tab (v3.1). "Commit…" (secondary).

### 9.3 Children

- Count in words ("1 subagent", "3 helper sessions", "2 related sessions").
- `ChildLine` list.
- A note explaining provenance and "relation unknown".

---

## 10. Pages

### 10.1 Accounts (page tab; the 2.11 table, kept)

- **Header** "Accounts", subline "Each sign-in, where it is used, what is left in every window, and when it warns", and "+ Add account".
- **View switch:** segmented "Accounts 5 · Usage history · Projects & pools 4", then "next refresh in 5 min" and "↻ Refresh".
- **Per tool group:** small-caps name plus count, and on the right "▣ Plain `claude` starts on ▍work".
- **Columns:**
  - `#` (accent for the default).
  - **Account**: AccountMark, name, "Default" / "next in work" meta chips, state word; second line email · copy · label.
  - **Used in**: "2 running" / "idle".
  - **Windows · tick = even pace**: every window as a full `LimitBar`, then "checked 1m ago" (amber "stale, refreshing" when stale).
  - **Protect**: shield plus %, tooltip "Warns at this share".
  - **Actions**: "Use" (ghost, not on the default), "Sign in" (accent, when needed), open a terminal on this account, ⋯.

### 10.2 All sessions (page tab)

- Filter input, State segmented (All / Live / Done), Tool segmented (Any / Claude / Codex).
- The batch bar (labelled variant), then the table: checkbox · state plus title · account (AccountMark, "Claude · work") · branch plus `#PR` with CI icon · model · thinking · context % · last active.

### 10.3 Library (page tab)

- **Header:** "Pinned sessions are kept in the vault, so Claude's own cleanup can't take them." The header switch "Auto-keep sessions with an open PR" is on by default.
- **Controls:** search (name, summary, folder, branch, PR), segmented All / Pinned / Archived, "vault 11.6 MB".
- **Deadline banner** (warn): "“Release notes 2.11” will be deleted by Claude in 3 days." with "📌 Keep it".
- **Columns:**
  - Pin (filled accent when pinned).
  - Session: name, archived chip, tags; second line AccountMark plus summary.
  - Where: project; second line branch plus PR.
  - Last.
  - Kept?:

    | State | Look |
    |---|---|
    | kept | vault green "kept · 2.4 MB" |
    | at risk | amber "Claude deletes it in N d" when ≤ 7 days, muted otherwise |
    | lost | red "transcript gone" |

  - "Resume…" (or "can't resume") and Archive/Restore.

### 10.4 Tools (page tab)

A card with one row per tool: name plus path, version, then "up to date" (meta
chip) or "⇩ Update to x" (accent). Updates never touch running sessions.
Updates also arrive as Needs-you items.

### 10.5 Settings (page tab)

- **Left nav:** General, Appearance, Sign-ins, Protection, Distribution, Notifications, Desktop pet, Providers, Claude Code, Open in, Agents, Remote, Updates, Advanced. The current item has the Marker.
- **Appearance:**
  - Mode segmented (Dark / Light / Sync with OS), with the pairing shown next to it.
  - Theme cards grouped by JetBrains, Agent Switch, Popular and Accessibility. Each card is a mini preview of the real window. The selected card has an accent border plus a 2 px accent-line ring.
  - Details: Accent (Theme / Agent Switch), "Terminal uses the theme's colours" switch, Contrast note, "About <theme>" with the source.
- **Claude Code:** one `~/.claude/settings.json` for every Claude account (`claude-settings`; a global value wins, lists are combined, an account's own values stay).
  - Header card: the file path, how many accounts are up to date, "Apply now".
  - A filter over settings and commands; while it holds text, every matching section is open and the rest are hidden.
  - Collapsible sections, only Behaviour open at first: Behaviour (environment switches, model, permission mode), Allowed commands (catalog groups as checkbox pills with All/None, "Your other rules", add a rule), Plugins, Hooks (read-only), More in the file (read-only), Accounts (state and own values).
- **Open in:**
  - Targets list. Agent apps are offered only for their own tool; editors open the worktree root.
  - Default for the Open button, globally and per repository.
  - "Terminal" select: only installed terminals (macOS: Terminal, iTerm2, Ghostty, Warp, WezTerm, kitty, Alacritty). It is what "Terminal › new here" opens and where a takeover's new window starts (Warp cannot run a command, so a takeover then uses Terminal).
  - "Focus terminal" switch, with the macOS Automation note (error −1743 is explained, not hidden). Focus works with Terminal and iTerm2.
- **Agents** (v3.2): one row per agent with its integration class ("deep" / "ACP" / "terminal only") and a switch.
- **Remote** (v3.2):
  - Stages R1 Claude Remote Control (on), R2 own tunnel SSH/Tailscale (on), R3 E2E relay (later).
  - No stage opens a port outside the user's network.
  - Paired devices with scopes.

### 10.6 First run

- No accounts yet. One path, no tour.
- Detected tools with their sign-in state, "Add as “work”" (accent) or "Install…".
- "Add both and continue" (primary). Next comes the shell integration, which is shown before it changes anything.

### 10.7 Tray (macOS menu bar, w 360)

The same components as the window, in this order:
1. Needs you (3 rows plus "N more ›")
2. Sessions (5 rows, same order, plus "N more ›")
3. Limits strip
4. "Start session" (primary) and "Open Agent Switch"

### 10.8 Chat view (v3.1, hosted sessions only)

- It is the same session as the terminal; the switch is in the session bar.
- **Usage hint strip** (under the session bar, terminal and chat alike; owner request 2026-11-05): the most pressing of — account near its 5-hour limit ("Move…"), context ≥ 60 % full ("New task? /clear … Same task: /compact", warn from 85 %; "Compact"), warm cache in its last 90 s ("A reply now reuses it"), cold cache re-sending ≥ 50k tokens ("Compact"). Warn tint for warnings, panel for hints, "+N" for the rest, ✕ hides it until its situation changes. Thresholds: `gui/src/v3/hints.ts`.
- **Copy conversation** (header, right; a 28 px bar above a read-only timeline): the whole session as Markdown from the source text, edits as `diff` fences. The hosted terminal has "Copy terminal output" top right on hover: the scrollback as plain text.
- **User bubble:** right-aligned, raise fill, 10 px.
- **Assistant prose:** soft text rendered as markdown (owner request 2026-11-05): headings, lists and task lists, tables in a horizontal scroller, code in a 10 px panel with its language and a copy button, a `diff` fence in the diff view, `<details>` as a collapsed 10 px panel, links only for http(s): a click copies the address, ⌘-click (Ctrl-click) opens it in the browser; the tooltip shows the address and says so, a short note confirms what happened. Other HTML stays literal text. Plan text the same. User bubbles stay plain. Dialect: `agents/evidence/markdown-corpus-2026-11.md`.
- **Tool cards:** 10 px, collapsible (chevron); a state dot, the tool name and the argument in mono. "Update" opens to a diff with add/del line backgrounds.
- **Subagent "Task" row:** state, worktree badge (violet) and "subagent · via hook".
- **Approval card** (warn tint): "Claude wants to run a command", the command in mono, then "✓ Allow once ↵" (accent), "Always allow “npx vitest”" (secondary), "Deny" (danger), and "Same rule as the terminal prompt · never bypassed".
- **Composer:**
  - Attachment chips (image, `@file`).
  - Placeholder while a turn runs: "Queue a message — sent when this turn ends · @ files · / commands · drop images".
  - Attach and Mode ("Ask before edits ▾").
  - "Stop ⌘." and "Queue ↵" (accent). Proposal: when no turn runs, Queue becomes "Send".

### 10.9 Review (v3.1, page tab)

- **Scope segmented:** This turn / Session / Worktree vs main / Staged. Plus Unified / Split.
- **While a turn runs:** an info strip says "A turn is running — stage and discard unlock when it ends". Stage, discard and revert are **disabled** with the tooltip "Unlocks when the turn ends".
- **File tree:** the current file has the Marker.
- **Diff:** line comments are "sent when the turn ends". Then "Commit N staged…" and "Create PR".

---

## 11. Where every 2.11 function went (must stay true)

| 2.11 | v3 |
|---|---|
| Overview: needs you, running now, what's left | Needs-you zone (pill in focus mode) · Sessions window · Limits strip |
| Sessions list, filters, trash | Sessions window · All sessions page · Library |
| Session sheet: move, take over, hand off, compact | Session bar ⋯ · Move → decision sheet |
| Near-limit decision | Needs-you "Decide" → same sheet, never automatic |
| Accounts, sign-ins, usage history | Accounts page (table unchanged) |
| Pools, projects, protection | Accounts › Projects & pools · Settings › Protection |
| Tools, agent-config card, updates | Tools page · updates as Needs-you items |
| Apps (detected editors) | Settings › Open in |
| Activity, notifications | Inbox behind the pill (history) |
| Health | Title bar ("Engine stopped" when down) |
| Start session with routing explanation | ⌘N · Account "Why?" keeps the 2.11 lines |
| Tray, pet | Tray as above · pet unchanged |
| Terminal sheet (installs, logins) | Unchanged modal |

---

## 12. Keyboard

| Key | Does |
|---|---|
| ⌘K | Palette |
| ⌘N | New session (⌘↵ in the dialog starts) |
| ⌘J | Focus the next Needs-you item; then ↵ = its verb, ⇧↵ = always (approvals), ⌫ = deny, Y = yes (questions), L = later |
| ⌘1…⌘9 | Tab N |
| ⌃Tab | Recent sessions switcher |
| ⌘B | Hide/show the Sessions window (focus mode) |
| ⌘I | Hide/show Summary |
| ⌘O | Open in the default target |
| ⌘⇧M | Move session to another account… |
| ⌘. | Stop the running turn (chat) |
| ⌘, | Settings |
| Esc | Close popover/dialog, clear selection |

While the terminal has focus, app shortcuts must not steal keys the CLI
needs. On Linux/Windows the app keys are Ctrl+Shift+… while the terminal has
focus. All keys can be rebound.

### Board → view id (`?view=`)

| Page | View ids |
|---|---|
| v3.0 Central | main, summary, peek, limits, morning, needs, inbox, comfortable, switcher, palette, openin, model, conflict, external, tree, batch, new, decide, end, focus, accounts, table, library, resume, tools, editors, offline, firstrun, tray |
| Themes | appearance, gallery, plus `main` in other themes |
| v3.1 Client | chat, review |
| v3.2 Reach | agents, remote |
| Design check | map |

---

## 13. Behaviour rules the implementation must keep

1. **No automatic account switch, ever.** Near-limit leads to a Needs-you "Decide" item plus amber marks, and nothing else.
2. **Model and thinking changes apply from the next turn.** In the user's own terminal they are locked, and the chip says why.
3. **Chat and Review need a hosted session.** Otherwise they are disabled with the reason.
4. **Stage, discard and revert are disabled while a turn runs.** Messages typed meanwhile are queued, not sent.
5. **Approvals in app, tray and remote are the same decision as the terminal prompt.** Answering in one place answers it everywhere.
6. **Provenance is required for every relation and git/PR fact.** `kind: "unknown"` renders as "relation unknown". No heuristic parent.
7. **Ending is explicit.** Closing a tab never ends a session.
8. **Merged sessions auto-archive after 24 h.** Worktree cleanup skips dirty worktrees.
9. **Stale usage is drawn greyed with its age, never as current.**
10. **"Open in" uses launchers, not URL schemes.** Agent-app entries only claim "opens this project" until resuming the same conversation there is verified for that app version.

---

## 14. Done means (acceptance for each screen)

- Rendered at 1440×900 in **darcula, github-light and one high-contrast theme**. `scratchpad`-style check:
  - no element clipped (`scrollWidth > clientWidth` on non-scrolling elements);
  - no unplanned line wrap;
  - no misaligned baseline in rows.
- Every mark in §3 means one thing:
  - grep for inset-shadow selection bars `shadow-[inset_2px` / `shadow-[inset_0_2px` (must be gone);
  - every "where you are" item uses `Marker` or the tab frame;
  - every chosen option in a list uses a check;
  - every segmented control uses `ui/Segmented`.
- Corners follow §3.1. No other radii.
- Contrast tests pass (`themes.test.ts`). New tokens get a floor.
- Every 2.11 row in §11 is reachable in ≤ 2 clicks from the main window.

## 15. Open questions for the owner (not decided)

1. Should comfortable density (account · branch on every row) be the default? Today it is compact; only the active row has the second line.
2. Limits strip: pinned to the bottom (today) or right under the session list?
3. Claude Desktop / Codex Desktop: can they resume the same conversation, or only open the project? It is unverified, so the menu says "opens this project".
