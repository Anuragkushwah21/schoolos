"use client";

import { useActionState } from "react";

import { useT } from "@/components/i18n/i18n-provider";
import { FieldError } from "@/components/shared/field-error";
import { Spinner } from "@/components/shared/spinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ActionResult } from "@/lib/action-result";

import { loginAction } from "./actions";

const initialState: ActionResult<undefined> = { status: "idle" };

export function LoginForm() {
  const t = useT();
  const [state, formAction, isPending] = useActionState(
    loginAction,
    initialState,
  );

  const fieldErrors = state.status === "error" ? state.fieldErrors : undefined;
  // A form-level failure (bad credentials, rate limited) rather than a
  // per-field one. Field errors are shown against their own inputs.
  const formError =
    state.status === "error" && !fieldErrors ? state.message : undefined;

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      {formError ? (
        <div
          role="alert"
          className="border-destructive/30 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm"
        >
          {formError}
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="email">{t("login.email")}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={Boolean(fieldErrors?.email)}
          aria-describedby={fieldErrors?.email ? "email-error" : undefined}
        />
        <FieldError id="email-error" messages={fieldErrors?.email} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="password">{t("login.password")}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={Boolean(fieldErrors?.password)}
          aria-describedby={fieldErrors?.password ? "password-error" : undefined}
        />
        <FieldError id="password-error" messages={fieldErrors?.password} />
      </div>

      <Button
        type="submit"
        // Disabled the moment the action starts, so a second press cannot send
        // a second sign-in attempt at the rate limiter.
        disabled={isPending}
        aria-busy={isPending || undefined}
        size="lg"
        className="w-full"
      >
        {isPending ? (
          <>
            <Spinner />
            {t("login.submitting")}
          </>
        ) : (
          t("login.submit")
        )}
      </Button>
    </form>
  );
}
