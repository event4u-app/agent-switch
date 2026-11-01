/**
 * The GUI's one translation layer (roadmap D7). No runtime dependency: a flat
 * key → string table per language, `{param}` interpolation, plurals through
 * `Intl.PluralRules`, numbers through `Intl.NumberFormat`.
 *
 * Language follows the OS/browser (`navigator.language`) unless Settings ›
 * General pins one. The CLI stays English; `PET_WELCOME` stays English on
 * purpose and never goes through here.
 */

import { useSyncExternalStore } from "react";
import { getLanguagePref, setLanguagePrefFlag, type LanguagePref } from "../settings-store.js";
import { de } from "./de/index.js";
import { en } from "./en/index.js";

export type Lang = "en" | "de";
export type { LanguagePref };

type Dict = typeof en;
export type TKey = keyof Dict;
/** Base names of the plural sets: `x_one` + `x_other` → `x`. */
export type PluralKey = TKey extends infer K ? (K extends `${infer B}_other` ? B : never) : never;
export type Params = Record<string, string | number>;

export const LANGUAGES: readonly Lang[] = ["en", "de"];
const TABLES: Record<Lang, { readonly [K in TKey]: string }> = { en, de };

/** "de-AT" / "de" → de; everything else → en. */
export function resolveLanguage(pref: LanguagePref, systemLanguage: string | undefined): Lang {
  if (pref !== "system") return pref;
  return (systemLanguage ?? "").toLowerCase().startsWith("de") ? "de" : "en";
}

function systemLanguage(): string | undefined {
  try {
    return navigator.language;
  } catch {
    return undefined;
  }
}

let current: Lang = resolveLanguage(getLanguagePref(), systemLanguage());
const listeners = new Set<() => void>();

function markDocument(): void {
  try {
    document.documentElement.lang = current;
  } catch {
    /* no DOM */
  }
}
markDocument();

function emit(next: Lang): void {
  if (next === current) return;
  current = next;
  markDocument();
  for (const l of listeners) l();
}

export function getLang(): Lang {
  return current;
}

/** BCP-47 locale for `Intl`: the language with the system region when it matches. */
export function locale(): string {
  const sys = systemLanguage();
  return sys && sys.toLowerCase().startsWith(current) ? sys : current;
}

/** Persist the preference and switch the live language. */
export function setLanguagePref(pref: LanguagePref): void {
  setLanguagePrefFlag(pref);
  emit(resolveLanguage(pref, systemLanguage()));
}

/** Re-read the stored preference (another window changed it). */
export function syncLanguageFromStore(): void {
  emit(resolveLanguage(getLanguagePref(), systemLanguage()));
}

/** Tests only: pin a language without touching storage. */
export function setLangForTests(lang: Lang): void {
  emit(lang);
}

export function subscribeLang(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The live language; re-renders the caller when it changes. */
export function useLang(): Lang {
  return useSyncExternalStore(subscribeLang, getLang, getLang);
}

export function fmtNumber(n: number, opts?: Intl.NumberFormatOptions): string {
  try {
    return new Intl.NumberFormat(locale(), opts).format(n);
  } catch {
    return String(n);
  }
}

function interpolate(s: string, params?: Params): string {
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, name: string) => {
    const v = params[name];
    if (v === undefined) return m;
    return typeof v === "number" ? fmtNumber(v) : v;
  });
}

/** Translate `key` into the live language; `{name}` takes `params.name`. */
export function t(key: TKey, params?: Params): string {
  const s = TABLES[current][key] ?? en[key] ?? key;
  return interpolate(s, params);
}

/** Plural: `tp("x", n)` picks `x_one` / `x_other` by `Intl.PluralRules`;
 *  `{count}` is the formatted number. */
export function tp(base: PluralKey, count: number, params?: Params): string {
  let cat: string;
  try {
    cat = new Intl.PluralRules(locale()).select(count);
  } catch {
    cat = count === 1 ? "one" : "other";
  }
  const table = TABLES[current] as Record<string, string>;
  const key = `${base}_${cat}`;
  const s = table[key] ?? table[`${base}_other`] ?? (en as Record<string, string>)[`${base}_other`] ?? base;
  return interpolate(s, { count, ...params });
}

/** For parity tests. */
export function tables(): Record<Lang, Record<string, string>> {
  return TABLES as Record<Lang, Record<string, string>>;
}
