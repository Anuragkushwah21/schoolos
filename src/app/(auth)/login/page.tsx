import type { Metadata } from "next";
import { AuthCard } from "@/features/auth/auth-card";
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
    <AuthCard title={t("login.title")} subtitle={t("login.subtitle")} corner={<LanguageSelector />}>
      <LoginForm />
    </AuthCard>
  );
}
