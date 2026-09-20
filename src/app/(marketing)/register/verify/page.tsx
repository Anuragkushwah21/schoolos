import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { MailCheckIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ResendCodeForm, VerifyEmailForm } from "@/features/platform/verify-form";
import { CODE_TTL_MINUTES, getVerificationState } from "@/server/platform/verification";

export const metadata: Metadata = { title: "Verify your email" };

/**
 * Step two of registering: prove you can read the address you gave.
 *
 * The reference in the URL names a pending registration, which is not a
 * secret — it grants nothing, and the code is what actually has to be right.
 */
export default async function VerifyEmailPage(props: PageProps<"/register/verify">) {
  const { ref } = await props.searchParams;
  const reference = typeof ref === "string" ? ref.slice(0, 80) : null;
  if (!reference) notFound();

  const state = await getVerificationState(reference);
  if (!state) notFound();
  if (state.status === "verified") {
    redirect(`/register/submitted?ref=${encodeURIComponent(reference)}`);
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-8 px-4 py-20">
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="bg-primary/10 text-primary flex size-14 items-center justify-center rounded-full">
          <MailCheckIcon className="size-7" aria-hidden />
        </span>
        <h1 className="text-3xl font-semibold tracking-tight">Check your email</h1>
        <p className="text-muted-foreground">
          We sent a six-digit code to <span className="text-foreground font-medium">{state.email}</span>.
          It expires in {CODE_TTL_MINUTES} minutes.
        </p>
      </div>

      <div className="bg-card ring-foreground/10 rounded-2xl p-6 shadow-sm ring-1">
        <VerifyEmailForm reference={reference} />
      </div>

      <div className="flex flex-col items-center gap-1 text-center">
        <p className="text-muted-foreground text-sm">Did not get it? Check spam, or ask for another.</p>
        <ResendCodeForm reference={reference} />
        <Button asChild variant="link" size="sm">
          <Link href="/register">Start over with a different email</Link>
        </Button>
      </div>
    </main>
  );
}
