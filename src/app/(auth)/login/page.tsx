import type { Metadata } from "next";
import Link from "next/link";

import { Logo } from "@/components/shared/logo";
import { LoginForm } from "@/features/auth/login-form";
import { LanguageSelector } from "@/features/i18n/language-selector";
import { redirectIfAuthenticated } from "@/server/auth/current-user";
import { getT } from "@/server/i18n";

export const metadata: Metadata = { title: "Sign in" };

/**
 * One sign-in page for everyone. Where a person lands afterwards follows from
 * their role (`ROLE_HOME`), never from anything they choose here.
 */
export default async function LoginPage() {
  // Someone already signed in has no business on the login form.
  await redirectIfAuthenticated();
  const t = await getT();

  return (
    <main className="flex flex-1 flex-col px-4 py-6">
      <div className="flex justify-end">
        <LanguageSelector />
      </div>
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8 py-10">
        <div className="flex flex-col gap-3">
          <Link href="/" className="w-fit" aria-label="SchoolOS home">
            <Logo />
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">{t("login.title")}</h1>
          <p className="text-muted-foreground">{t("login.subtitle")}</p>
        </div>
        <div className="bg-card rounded-2xl border p-6 shadow-[0_1px_3px_rgb(15_23_42/0.06)]">
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
