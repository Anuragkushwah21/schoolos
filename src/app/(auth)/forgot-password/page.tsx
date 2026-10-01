import type { Metadata } from "next";

import { AuthCard } from "@/features/auth/auth-card";
import { ForgotPasswordForm } from "@/features/auth/account-forms";
import { redirectIfAuthenticated } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Forgot password" };

export default async function ForgotPasswordPage() {
  await redirectIfAuthenticated();
  return (
    <AuthCard title="Forgot your password?" subtitle="Enter the email you sign in with. We will send you a link to choose a new password.">
      <ForgotPasswordForm />
    </AuthCard>
  );
}
