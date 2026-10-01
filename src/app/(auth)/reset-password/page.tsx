import type { Metadata } from "next";
import Link from "next/link";

import { AuthCard } from "@/features/auth/auth-card";
import { SetPasswordForm } from "@/features/auth/account-forms";
import { param } from "@/lib/search-params";
import { inspectLink } from "@/server/auth/account-links";

export const metadata: Metadata = { title: "Choose a new password" };

/** Opened from the reset email. The link is checked here, and again when it is used. */
export default async function ResetPasswordPage(props: PageProps<"/reset-password">) {
  const token = param((await props.searchParams).token) ?? "";
  const link = await inspectLink(token, "PASSWORD_RESET");
  if (!link) {
    return (
      <AuthCard title="This link has expired" subtitle="Reset links work once and only for 30 minutes.">
        <p className="text-sm">
          Ask for a new one from{" "}
          <Link href="/forgot-password" className="text-primary hover:underline">
            Forgot password
          </Link>
          .
        </p>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Choose a new password" subtitle={`${link.user.email} · your old password stops working once you save.`}>
      <SetPasswordForm token={token} purpose="PASSWORD_RESET" />
    </AuthCard>
  );
}
