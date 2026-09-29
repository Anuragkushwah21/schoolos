/**
 * Interface languages.
 *
 * Adding a language is three steps: add its code here, add a dictionary in
 * `messages/<code>.ts` typed as `Messages` (the compiler then lists every
 * missing key), and register it in `messages/index.ts`. Nothing else changes.
 *
 * Only the interface is translated. Names, addresses, admission numbers and
 * anything a teacher or the office wrote are shown exactly as entered.
 */

export const LOCALES = ["en", "hi"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/** The browser cookie that carries the choice before (and alongside) sign-in. */
export const LOCALE_COOKIE = "schoolos_lang";

/** Each language named in itself, so a reader can always find their own. */
export const LOCALE_LABEL: Record<Locale, string> = {
  en: "English",
  hi: "हिन्दी",
};

/** The BCP 47 tag used for dates, numbers and currency. Indian conventions for both. */
export const INTL_LOCALE: Record<Locale, string> = {
  en: "en-IN",
  hi: "hi-IN",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}
