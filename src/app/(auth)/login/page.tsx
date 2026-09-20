import type { Metadata } from "next";
import Link from "next/link";

import { LoginForm } from "@/features/auth/login-form";
import { redirectIfAuthenticated } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  // Someone already signed in has no business on the login form.
  await redirectIfAuthenticated();

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8 px-6 py-16">
      <div className="flex flex-col gap-2">
        <Link href="/" className="text-muted-foreground text-sm font-medium">
          SchoolOS
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-muted-foreground text-sm">
          Use the account your school administrator issued you.
        </p>
      </div>

      <LoginForm />
    </main>
  );
}
