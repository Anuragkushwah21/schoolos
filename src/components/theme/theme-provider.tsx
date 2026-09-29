"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Light / dark / follow-the-device theme.
 *
 * `next-themes` stores the choice in this browser and writes the `dark` class
 * onto <html> from an inline script before first paint, so a page never
 * flashes the wrong theme while loading. The colours themselves live in
 * `globals.css` (`:root` and `.dark`).
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange storageKey="schoolos-theme">
      {children}
    </NextThemesProvider>
  );
}
