"use client";

import Link from "next/link";
import { useActionState } from "react";

import { FieldError } from "@/components/shared/field-error";
import { Spinner } from "@/components/shared/spinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ActionResult } from "@/lib/action-result";

import { forgotPasswordAction, setPasswordAction } from "./account-actions";

const idle: ActionResult<undefined> = { status: "idle" };

function Alert({ tone, children }: { tone: "error" | "success"; children: React.ReactNode }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={
        tone === "error"
          ? "border-destructive/30 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm"
          : "border-success/30 bg-success-soft text-success-strong rounded-md border px-3 py-2 text-sm"
      }
    >
      {children}
    </div>
  );
}

/** Enter an email; the answer never says whether it has an account. */
export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(forgotPasswordAction, idle);
  const fieldErrors = state.status === "error" ? state.fieldErrors : undefined;
  if (state.status === "success") {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="success">{state.message}</Alert>
        <Link href="/login" className="text-primary text-sm hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {state.status === "error" && !fieldErrors ? <Alert tone="error">{state.message}</Alert> : null}
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required aria-invalid={Boolean(fieldErrors?.email)} />
        <FieldError id="email-error" messages={fieldErrors?.email} />
      </div>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? <Spinner /> : null}
        Send reset link
      </Button>
      <Link href="/login" className="text-muted-foreground text-center text-sm hover:underline">
        Back to sign in
      </Link>
    </form>
  );
}

/** Choose a password from an activation or reset link. */
export function SetPasswordForm({ token, purpose }: { token: string; purpose: "ACTIVATION" | "PASSWORD_RESET" }) {
  const [state, action, pending] = useActionState(setPasswordAction, idle);
  const fieldErrors = state.status === "error" ? state.fieldErrors : undefined;
  const linkError = fieldErrors?.token?.[0];
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="purpose" value={purpose} />
      {state.status === "error" && (!fieldErrors || linkError) ? <Alert tone="error">{linkError ?? state.message}</Alert> : null}
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">New password</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required aria-invalid={Boolean(fieldErrors?.password)} />
        <p className="text-muted-foreground text-xs">At least 8 characters.</p>
        <FieldError id="password-error" messages={fieldErrors?.password} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="confirm">Type it again</Label>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required aria-invalid={Boolean(fieldErrors?.confirm)} />
        <FieldError id="confirm-error" messages={fieldErrors?.confirm} />
      </div>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? <Spinner /> : null}
        {purpose === "ACTIVATION" ? "Activate and sign in" : "Save password and sign in"}
      </Button>
    </form>
  );
}
