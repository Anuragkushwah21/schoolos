import "server-only";

import { cache } from "react";
import { cookies, headers } from "next/headers";

import { DEFAULT_LOCALE, INTL_LOCALE, LOCALE_COOKIE, type Locale, isLocale } from "@/lib/i18n/config";
import { MESSAGES, type Messages } from "@/lib/i18n/messages";
import { type Translator, createTranslator } from "@/lib/i18n/translate";
import { getCurrentUser } from "@/server/auth/current-user";

/**
 * The interface language for this request.
 *
 * In order: the signed-in person's own choice (stored on their user row, so it
 * follows them to any device), then the browser cookie (set by the selector,
 * so it works on the login page too), then the browser's own preference, then
 * English. Only the interface changes — this never touches what data a request
 * can reach, and a value that is not a known language is simply ignored.
 */
export const getLocale = cache(async (): Promise<Locale> => {
  const user = await getCurrentUser();
  if (isLocale(user?.preferredLanguage)) return user.preferredLanguage;

  const cookieValue = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(cookieValue)) return cookieValue;

  const accept = (await headers()).get("accept-language") ?? "";
  if (/^hi\b/i.test(accept.trim())) return "hi";

  return DEFAULT_LOCALE;
});

export async function getMessages(): Promise<Messages> {
  return MESSAGES[await getLocale()];
}

/** `t` for Server Components: `const t = await getT(); t("nav.students")`. */
export const getT = cache(async (): Promise<Translator> => createTranslator(await getMessages()));

/** The Intl tag for formatting dates, numbers and money in this request's language. */
export async function getIntlLocale(): Promise<string> {
  return INTL_LOCALE[await getLocale()];
}
