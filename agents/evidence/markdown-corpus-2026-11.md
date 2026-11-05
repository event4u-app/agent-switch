# Markdown in agent output — corpus counts and the rendered dialect

Roadmap: `road-to-a-chat-that-reads-well` 2.1 / 2.2. Read 2026-11-05 on the
owner's machine: every `*.jsonl` under `~/.agent-switch/{claude,codex}/`
(769 files), Claude Code 2.1.316, codex-cli 0.166.0. Only counts left the
machine. The fixtures in `gui/src/v3/markdown/fixtures.ts` are written by hand
in the measured shapes — transcript text is private work and the repository is
public, so none of it is copied.

## Counts (messages containing the feature at least once)

| Feature | Claude (8 323 msgs) | Codex (93 msgs) |
|---|---:|---:|
| inline code | 3 333 | 46 |
| bold | 962 | 49 |
| `snake_case` words (emphasis must not fire) | 939 | 40 |
| bullet list | 842 | 31 |
| bare `http(s)` URL | 574 | 0 |
| ordered list | 415 | 29 |
| ATX heading | 322 | 4 |
| nested list (≥ 2 spaces) | 241 | 3 |
| hr | 193 | 0 |
| GFM table | 115 | 6 |
| fenced code (backtick) | 100 | 1 |
| inline link | 55 | 0 |
| blockquote | 19 | 0 |
| `_italic_` | 7 | 0 |
| tilde fence | 6 | 0 |
| `<details>` | 4 | 0 |
| fence inside a list item | 2 | 0 |
| nested list ≥ 4 spaces | 3 | 0 |
| escaped `\|` in a table row | 1 | 0 |
| code span holding `\|` in a table row | 1 | 0 |
| ```` ```diff ```` fence, longer fence, task list, strikethrough, reference link, angle autolink, image, indented code, setext heading, entity | 0 | 0 |

Sizes: Claude average 563 chars, longest 36 896 chars, longest fence 347
lines, deepest list indent 5 spaces. Codex average 2 087 chars, longest 6 886.

Tag-shaped text outside code (Claude, occurrences): `<br>` 21, everything else
≤ 2 each — placeholders such as `<slug>`, `<owner>`, `<repo>`, `<ticket>`.

What this changes against the plan's assumptions:

- `<br>` inside table cells is the most common HTML in real output → it is
  rendered as a line break (the only tag besides details/summary).
- Placeholders like `<slug>` are common → every other tag must stay literal
  text, never vanish.
- ```` ```diff ```` did not occur → the diff view for fences is cheap to keep but
  must not be optimised for; plain code is its fallback.
- Bare URLs dominate links (574 vs 55) → GFM autolinking matters more than
  inline links.

## The rendered dialect (2.2)

Parser: `marked` 18.1.1, one private `Marked` instance, `gfm: true`,
`breaks: false`. Its block and inline grammar is kept as is, including
reference links and setext headings (both unseen, both cheap to keep). What is
ours is what the tokens become:

| Construct | Rendered as |
|---|---|
| paragraphs, ATX/setext headings, bullet/ordered/task lists (any nesting), blockquote, hr | the matching element; task checkboxes are disabled |
| GFM table | a table in a horizontal scroller; column alignment kept |
| fenced/indented code | a code block, text byte-exact, language shown as a label |
| ```` ```diff ```` (also `patch`) | the chat's diff view when the body holds at least one `+`/`-` line; line numbers only from `@@ -a,b +c,d @@` headers, never invented; else plain code |
| inline code, bold, italic, strikethrough | the matching inline element |
| link / autolink | a link only when the destination is an absolute `http:` or `https:` URL (parsed with `URL`, no control characters); otherwise its text as plain text |
| image | inert text: the alt text, never a fetch |
| `<br>`, `<br/>`, `<br />` | a line break |
| `<details>` … `</details>` | a native disclosure — see below |
| any other HTML, block or inline | literal text, exactly as written |

`<details>` grammar: an HTML token whose lines are each exactly `<details>`,
`<summary>…</summary>` (summary text is inline markdown, no tags) or
`</details>` opens or closes a disclosure; lines of such a token that are not
tag lines are parsed again as markdown. Tags inside code are code, because the
parser has already decided what is code. Nesting is allowed. At the first
`<summary>` directly after an opener the disclosure takes it as its title;
without one the title is "Details". A `</details>` with nothing open stays
literal. While the message is live, an unclosed disclosure stays open-ended
and provisional; in a finished message it is closed at the end of its
container. Disclosures start collapsed and keep their open state while text
streams in.

Newlines: code keeps every character of the source including trailing
whitespace; a trailing newline of the fence body is dropped, as CommonMark does.

Copy and storage always use the source text, never the rendered form.

## Budgets (2.6)

Measured 2026-11-05 in `gui/src/v3/markdown/budget.test.ts` (vitest, jsdom,
Apple Silicon laptop, median of 7):

| Shape | Chars | Parse |
|---|---:|---:|
| open fence, 1 000 lines (beyond the corpus max of 347) | 54 804 | 0.1 ms |
| table, 1 000 rows with code, bold, links | 54 595 | 9 ms |
| list nested 60 levels | 4 189 | 1.4 ms |
| prose, 400 paragraphs | 26 578 | 3.3 ms |

Streaming the open fence in 200-char frames: 274 full re-parses, 9 ms total
(0.03 ms per frame) — the quadratic case the council warned about does not bite,
because `marked` captures an open fence's body without inline work. Keeping
unchanged blocks (`reuseBlocks`): 0.5 ms for the prose case.

Decision for D2: no stable-prefix cache and no worker. A full parse per
coalesced frame stays far below a frame for every shape the corpus produced.

Limits: above 200 000 characters or 20 000 tree nodes a message is plain text;
a parser or render error shows that message as plain text; Settings › Advanced ›
"Format chat replies" turns it off everywhere.

Not measured: DOM commit time in the real Tauri webview. The render check below
ran in headless Chromium.

## Render check (2.4)

`design.html?view=markdown` (design fixture, not shipped) renders every fixture
as an assistant reply. Headless Chromium 1100 px wide, darcula and github-light:
no console or page errors, no horizontal page overflow; table, nested and task
lists, labelled code with copy, numbered diff, nested disclosures (chevrons turn
when open), links only on http(s), raw HTML as text — all as specified.
