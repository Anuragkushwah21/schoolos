"use client";

import { createContext, useContext, useMemo } from "react";

import { INTL_LOCALE, type Locale } from "@/lib/i18n/config";
import type { Messages } from "@/lib/i18n/messages";
import { type Translator, createTranslator, translateDynamic } from "@/lib/i18n/translate";

/**
 * The request's language and dictionary, handed to Client Components once from
 * the root layout. The server already decided the language; the client never
 * works it out again, so the two cannot disagree.
 */
type I18nValue = { locale: Locale; messages: Messages; t: Translator };

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ locale, messages, children }: { locale: Locale; messages: Messages; children: React.ReactNode }) {
  const value = useMemo(() => ({ locale, messages, t: createTranslator(messages) }), [locale, messages]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useT() must be used inside <I18nProvider>.");
  return value;
}

export function useT(): Translator {
  return useI18n().t;
}

export function useLocale(): Locale {
  return useI18n().locale;
}

export function useIntlLocale(): string {
  return INTL_LOCALE[useI18n().locale];
}

/** Translate a runtime value such as a status, falling back to `fallback`. */
export function useTranslateDynamic(): (key: string, fallback: string) => string {
  const { messages } = useI18n();
  return (key, fallback) => translateDynamic(messages, key, fallback);
}
