import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CircleCheckIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getVerificationState } from "@/server/platform/verification";

export const metadata: Metadata = { title: "Registration received" };

export default async function RegistrationSubmittedPage(
  props: PageProps<"/register/submitted">,
) {
  const { ref } = await props.searchParams;
  const reference = typeof ref === "string" ? ref.slice(0, 80) : null;

  // Someone who lands here without finishing the code is sent back to it.
  if (reference) {
    const state = await getVerificationState(reference);
    if (state?.status === "pending") {
      redirect(`/register/verify?ref=${encodeURIComponent(reference)}`);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center gap-6 px-4 py-24 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
        <CircleCheckIcon className="size-7" aria-hidden />
      </span>
      <h1 className="text-3xl font-semibold tracking-tight">Email verified</h1>
      <p className="text-muted-foreground text-lg">
        Thank you. Your registration is now with the SchoolOS team for review.
        We will email you at the address you just verified as soon as it is
        approved — then sign in with the password you chose, and you will land
        on your school&apos;s dashboard.
      </p>
      {reference ? (
        <p className="bg-muted rounded-lg px-4 py-2 text-sm">
          Your reference: <span className="font-mono font-medium">{reference}</span>
        </p>
      ) : null}
      <Button asChild variant="outline" size="lg">
        <Link href="/">Back to the homepage</Link>
      </Button>
    </main>
  );
}
