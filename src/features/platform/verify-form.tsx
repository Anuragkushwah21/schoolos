"use client";

import { ActionForm } from "@/components/forms/action-form";
import { SubmitButton, TextField } from "@/components/forms/fields";

import { resendCodeAction, verifyEmailAction } from "./registration-actions";

export function VerifyEmailForm({ reference }: { reference: string }) {
  return (
    <ActionForm action={verifyEmailAction}>
      <input type="hidden" name="reference" value={reference} />
      <TextField
        name="code"
        label="Six-digit code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        placeholder="000000"
        className="[&_input]:h-12 [&_input]:text-center [&_input]:font-mono [&_input]:text-2xl [&_input]:tracking-[0.4em]"
        required
        autoFocus
      />
      <SubmitButton pendingLabel="Checking…" className="h-10 w-full">
        Verify email
      </SubmitButton>
    </ActionForm>
  );
}

export function ResendCodeForm({ reference }: { reference: string }) {
  return (
    <ActionForm action={resendCodeAction} className="gap-2">
      <input type="hidden" name="reference" value={reference} />
      <div>
        <SubmitButton variant="ghost" size="sm" pendingLabel="Sending…">
          Send a new code
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
