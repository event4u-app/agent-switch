/**
 * Notification text in two directions. The shared log (CLI + daemon own it)
 * keeps notices in English: the daemon's dedup window coalesces identical
 * text, and the pet's click routing (`bubbleAction`) reads the English title.
 * So the GUI writes the canonical English ({@link noticeEn}) and translates at
 * display time ({@link localizeNotification}): the `engines.notice.*` English
 * strings double as parse templates. Text matching no template — the daemon's
 * and the CLI's own wording — shows as logged.
 *
 * Pure: no Tauri imports, so vm/build.ts can use it.
 */

import { en } from "../../i18n/en/index.js";
import { getLang, t, type Params, type TKey } from "../../i18n/index.js";
import type { AppNotification } from "../../notifications.js";

type NoticeKey = Extract<TKey, `engines.notice.${string}`>;

/** The canonical English of a notice key — what goes into the log, whatever
 *  the live language. */
export function noticeEn(key: NoticeKey, params: Record<string, string> = {}): string {
  return (en[key] as string).replace(/\{(\w+)\}/g, (m, name: string) => params[name] ?? m);
}

/** Tried in order; where two templates could match one text, the more specific
 *  one comes first (a highlight before the plain body, agent-config's own title
 *  before the generic tool title). */
const TEMPLATES: readonly NoticeKey[] = [
  "engines.notice.limitNearTitle",
  "engines.notice.limitNearRebind",
  "engines.notice.limitNearManual",
  "engines.notice.switchedTitle",
  "engines.notice.switchedBody",
  "engines.notice.deactivatedTitle",
  "engines.notice.deactivatedBodyNamed",
  "engines.notice.deactivatedBody",
  "engines.notice.updatedTitle",
  "engines.notice.updatedBody",
  "engines.notice.updateFailedTitle",
  "engines.notice.updateFailedBody",
  "engines.notice.updateAvailableTitle",
  "engines.notice.updateAvailableBodyKind",
  "engines.notice.updateAvailableBody",
  "engines.notice.agentConfigTitle",
  "engines.notice.agentConfigBodyHighlight",
  "engines.notice.agentConfigBody",
  "engines.notice.toolUpdateTitle",
  "engines.notice.toolUpdateBody",
  "engines.notice.waitingTitle",
  "engines.notice.waitingBody",
  "engines.notice.usageFetchFailedTitle",
  "engines.notice.usageFetchFailedOutage",
  "engines.notice.usageFetchFailedBody",
];

interface Parser {
  key: NoticeKey;
  re: RegExp;
  names: string[];
}

let parsers: Parser[] | null = null;

function compile(key: NoticeKey): Parser {
  const names: string[] = [];
  const src = (en[key] as string)
    .split(/(\{\w+\})/)
    .map((part) => {
      const m = /^\{(\w+)\}$/.exec(part);
      if (!m) return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      names.push(m[1]);
      return "(.+?)";
    })
    .join("");
  return { key, re: new RegExp(`^${src}$`, "s"), names };
}

/** One logged title or message in the live language; unknown text unchanged. */
export function localizeNoticeText(text: string): string {
  if (!text || getLang() === "en") return text;
  parsers ??= TEMPLATES.map(compile);
  for (const p of parsers) {
    const m = p.re.exec(text);
    if (!m) continue;
    const params: Params = {};
    p.names.forEach((name, i) => (params[name] = m[i + 1]));
    return t(p.key, params);
  }
  return text;
}

/** The notice with its title and message in the live language. */
export function localizeNotification<N extends Pick<AppNotification, "title" | "message">>(n: N): N {
  return { ...n, title: localizeNoticeText(n.title), message: localizeNoticeText(n.message) };
}
