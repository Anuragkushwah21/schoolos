import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { AutoTranslate } from "@/components/i18n/auto-translate";
import { DEFAULT_LOCALE } from "@/lib/i18n/config";
import { MESSAGES } from "@/lib/i18n/messages";
import { getLocale } from "@/server/i18n";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "SchoolOS",
    template: "%s · SchoolOS",
  },
  description:
    "Multi-tenant school management: admissions, students, teachers, timetable and attendance for every school on one platform.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // The interface language for this person: their saved choice, else the
  // browser cookie, else English. Content people wrote is never translated.
  const locale = await getLocale();

  return (
    <html
      lang={locale}
      // next-themes sets the theme class before React hydrates.
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      // Not English: the page stays faded out until AutoTranslate has put its
      // text into the language (or, at worst, for 2.5 s), so it never flashes English.
      data-translating={locale === DEFAULT_LOCALE ? undefined : ""}
    >
      {locale === DEFAULT_LOCALE ? null : (
        <head>
          <script dangerouslySetInnerHTML={{ __html: "setTimeout(function(){document.documentElement.removeAttribute('data-translating')},2500)" }} />
        </head>
      )}
      <body className="flex min-h-full flex-col">
        <ThemeProvider>
          <I18nProvider locale={locale} messages={MESSAGES[locale]}>
            {children}
          </I18nProvider>
          <Toaster richColors position="top-right" />
          {/* Everything written in English on any screen, in the chosen language. */}
          {locale === DEFAULT_LOCALE ? null : <AutoTranslate locale={locale} />}
        </ThemeProvider>
      </body>
    </html>
  );
}
