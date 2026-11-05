/** A session as Markdown for the clipboard (roadmap road-to-a-chat-that-reads-well 3.1).
 *  Built from the folded rows, i.e. the source text of every message — never from
 *  what the chat drew. Pure. */

import type { ChatRow, DiffHunk } from "./timeline.js";

/** A fence longer than any backtick run inside `body`, so the body cannot close it. */
function fence(body: string, lang = ""): string {
  const longest = Math.max(2, ...[...body.matchAll(/`+/g)].map((m) => m[0].length));
  const f = "`".repeat(longest + 1);
  return `${f}${lang}\n${body}\n${f}`;
}

function hunkText(path: string, hunks: DiffHunk[]): string {
  const lines = [`--- a/${path}`, `+++ b/${path}`];
  for (const h of hunks) {
    const old = h.lines.filter((l) => l[0] !== "+").length;
    const nu = h.lines.filter((l) => l[0] !== "-").length;
    lines.push(`@@ -${h.oldStart},${old} +${h.newStart},${nu} @@`, ...h.lines);
  }
  return lines.join("\n");
}

function row(r: ChatRow): string {
  switch (r.k) {
    case "user":
      return `### You\n\n${r.text}${r.images ? `\n\n_(${r.images} ${r.images === 1 ? "image" : "images"})_` : ""}`;
    case "assistant":
      return `### Agent\n\n${r.text}`;
    case "tool": {
      const state = r.state === "failed" ? " (failed)" : r.state === "running" ? " (running)" : "";
      const head = `- **${r.name}**${r.summary ? ` \`${r.summary.replace(/`/g, "'")}\`` : ""}${state}${r.result ? ` — ${r.result}` : ""}`;
      const diffs = r.diffs.filter((d) => d.hunks.length).map((d) => fence(hunkText(d.path, d.hunks), "diff"));
      return [head, ...diffs].join("\n\n");
    }
    case "subagent":
      return `- **Task** (${r.type}) ${r.description}${r.state === "failed" ? " (failed)" : ""}`;
    case "approval":
      return `- **Approval** ${r.tool}: \`${r.summary.replace(/`/g, "'")}\` — ${r.resolved === "allow" ? "allowed" : r.resolved === "deny" ? "denied" : "waiting"}`;
    case "question":
      return r.questions.map((q) => `- **Question:** ${q.question} (${q.options.join(" / ")})`).join("\n");
    case "plan":
      return `**Plan**\n\n${r.text}`;
    case "error":
      return `> **Error:** ${r.message}`;
  }
}

export function sessionMarkdown(rows: readonly ChatRow[], title?: string | null): string {
  const parts = rows.map(row);
  if (title) parts.unshift(`# ${title}`);
  return `${parts.join("\n\n")}\n`;
}
