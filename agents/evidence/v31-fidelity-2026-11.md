# v3.1 fidelity rows — chat and review boards (2026-11)

drafted-at: 2026-11-03

The design acceptance of spec §14 for the two boards road-to-agent-switch-v3-client
adds, each row with the evidence taken. The source boards are the reference
patch's `v31.tsx` (chat, review) per ADR-008.

| Board | Chapter | Evidence |
|---|---|---|
| Chat | Layout 1440×900, three themes, nothing clipped or wrapped | `npm --prefix gui run v31-chat`: darcula, github-light, github-dark-hc — the render checks of `v3-render.mjs` (`inspect`) clean on the approval and the finished-turn screens |
| Chat | User bubble, tool cards, diff, approval card, question card, subagent row | `gui/src/v3/chat.test.tsx`, `chat-scale.test.tsx` (virtualised long timeline) |
| Chat | Composer: chips, queue placeholder, Attach, Mode, Stop ⌘., Queue ↵ | `gui/src/v3/composer.test.tsx`; the focus shows on the composer frame, not as a second ring on the field |
| Chat | One meaning per mark: chosen answer option carries a check | `chat.tsx` QuestionCard |
| Review | Layout 1440×900, three themes, unified and split | `v31-chat` review leg: Changes › Review changes over a real repository, stage a change, Split — render checks clean |
| Review | Scope and layout use `ui/Segmented`; current file uses `Marker` | `gui/src/v3/review.tsx`, `review.test.tsx` |
| Review | Locked while a turn runs, with the reason | `review.test.tsx` ("Unlocks when the turn ends" on every change action) |
| Both | No inset-shadow selection bars; radii from §3.1 only (10 px containers, `rounded-md` controls, `rounded-xl` floating layers, pill for the state dot) | grep over `chat.tsx`, `composer.tsx`, `chatview.tsx`, `review.tsx`, `mcp.tsx` |
| Both | Contrast floors | `gui/src/v3/themes` tests — no new tokens |
| Both | Reachable in ≤ 2 clicks | `reach.test.tsx` "v3.1 Review page"; chat: palette › New session in chat view, or the session bar switch |

Not covered here: the Codex chat path ran only against recorded protocol
fixtures — the Codex sign-ins on this machine do not refresh, so no live Codex
turn was rendered.
