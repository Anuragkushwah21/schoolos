import type { Metadata } from "next";
import Link from "next/link";

import { AuthCard } from "@/features/auth/auth-card";
import { SetPasswordForm } from "@/features/auth/account-forms";
import { param } from "@/lib/search-params";
import { inspectLink } from "@/server/auth/account-links";

export const metadata: Metadata = { title: "Activate your account" };

/** Opened from the activation email. The link is checked here, and again when it is used. */
export default async function ActivatePage(props: PageProps<"/activate">) {
  const token = param((await props.searchParams).token) ?? "";
  const link = await inspectLink(token, "ACTIVATION");
  if (!link) {
    return (
      <AuthCard title="This link has expired" subtitle="Activation links work once and only for a limited time.">
        <p className="text-sm">
          Ask your school office to send a new activation email. If you have already activated your account,{" "}
          <Link href="/login" className="text-primary hover:underline">
            sign in
          </Link>
          .
        </p>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Activate your account" subtitle={`${link.user.email} · choose a password to finish setting up SchoolOS.`}>
      <SetPasswordForm token={token} purpose="ACTIVATION" />
    </AuthCard>
  );
}
