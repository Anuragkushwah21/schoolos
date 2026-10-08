"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, GlobeIcon } from "lucide-react";

import { useLocale, useT } from "@/components/i18n/i18n-provider";
import { Spinner } from "@/components/shared/spinner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LOCALES, LOCALE_LABEL, type Locale } from "@/lib/i18n/config";

import { setLanguageAction } from "./actions";

/**
 * 🌐 English ▾ — each language is listed in its own script, so someone who
 * cannot read the current language can still find theirs.
 */
export function LanguageSelector({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();

  function choose(next: Locale) {
    if (next === locale) return;
    start(async () => {
      await setLanguageAction(next);
      router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size={compact ? "icon" : "default"} className={compact ? undefined : "gap-1 px-2 sm:px-3"} aria-label={`${t("language.choose")}: ${LOCALE_LABEL[locale]}`} disabled={pending}>
          {pending ? <Spinner size="xs" /> : <GlobeIcon aria-hidden />}
          {compact ? null : (
            // Always written out, on phones too: a globe alone means nothing to
            // someone who has never changed a language setting.
            <span lang={locale} className="text-xs sm:text-sm">
              {LOCALE_LABEL[locale]}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel>{t("language.label")}</DropdownMenuLabel>
        {LOCALES.map((option) => (
          <DropdownMenuItem key={option} onSelect={() => choose(option)} lang={option} aria-current={option === locale ? "true" : undefined}>
            <span className="flex-1">{LOCALE_LABEL[option]}</span>
            {option === locale ? <CheckIcon className="size-4" aria-hidden /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
