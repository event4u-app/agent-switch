/** Hand-written agent replies in the shapes measured over the local transcript
 *  corpus (agents/evidence/markdown-corpus-2026-11.md). No transcript text is
 *  copied: the corpus is private work, this repository is public. */

export const FIXTURES: Record<string, string> = {
  status: `Gerade ausgecheckt ist \`feat/capture-rights\`.`,

  commitTable: `Die letzten 4 Commits auf \`feat/capture-rights\`:

| Commit | Änderung | Dateien |
|---|---|---|
| \`051bf62\` | perf(ci): drop the PHPUnit result cache | \`quality-tests.yml\` (−16) |
| \`23598ff\` | perf(ci): more DB shards<br>no classmap on a cache hit | \`action.yml\`, \`quality-tests.yml\` (+32/−21) |
| \`2ed2bc8\` | fix(ci): a timed-out shard counts as failed | \`a\\|b\` and \`c|d\` |

Keiner dieser Commits betrifft Capture-Rights.`,

  nestedLists: `## Plan

1. **Parser** — use \`marked\` as lexer only
   - private instance, \`gfm: true\`
   - no token leaves the adapter
     - checked by a test
2. Renderer
   - fixed components

- [ ] corpus
- [x] dialect`,

  fences: `Run this:

\`\`\`bash
npm ci
npm test -- src/v3
\`\`\`

~~~ts
const a = 1;
~~~

- in a list:

  \`\`\`json
  { "a": 1 }
  \`\`\`

\`\`\`diff
@@ -10,3 +10,4 @@ export function f() {
   const a = 1;
-  return a;
+  const b = 2;
+  return a + b;
 }
\`\`\``,

  details: `Summary first.

<details>
<summary>Full log (**42** lines)</summary>

- step one
- step two

<details>
<summary>Inner</summary>

\`\`\`
inner code <details> stays code
\`\`\`

</details>
</details>

After.`,

  links: `See https://github.com/event4u-app/agent-switch/pull/152 and [the docs](https://example.com/a_b).
Not links: [js](javascript:alert(1)), [rel](./README.md), [file](file:///etc/passwd), <slug> and <owner>/<repo>.
![diagram](https://example.com/x.png)`,

  emphasis: `snake_case_name and 2*3*4 and **bold** _italic_ ~~gone~~ \`src/*.ts\``,

  quoteAndRule: `> **Note:** quoted
> second line

---

Done.`,

  rawHtml: `<div align="center">raw</div>

<script>alert(1)</script>

Text with <b onclick="x()">tag</b>.`,
};
