"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { type ActionResult, errorResult, successResult } from "@/lib/action-result";
import { LOCALE_COOKIE, isLocale } from "@/lib/i18n/config";
import { getCurrentUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db/prisma";

const ONE_YEAR = 60 * 60 * 24 * 365;

/**
 * Change the interface language.
 *
 * Anyone may call it, signed in or not: it only ever touches the caller's own
 * cookie and — when signed in — the `preferredLanguage` of the session's own
 * user row. No id is taken from the request, so it cannot change anybody else's
 * setting, and a language is not a permission: it grants nothing.
 */
export async function setLanguageAction(locale: string): Promise<ActionResult<undefined>> {
  if (!isLocale(locale)) return errorResult("That language is not available.");

  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", maxAge: ONE_YEAR, sameSite: "lax", httpOnly: false });

  const user = await getCurrentUser();
  if (user) await prisma.user.updateMany({ where: { id: user.id }, data: { preferredLanguage: locale } });

  revalidatePath("/", "layout");
  return successResult();
}
