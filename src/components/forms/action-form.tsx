"use client";

import {
  createContext,
  startTransition,
  useActionState,
  useContext,
  useEffect,
  useRef,
} from "react";
import { toast } from "sonner";

import { CredentialsNotice, SecretNotice } from "@/components/forms/credentials-notice";
import type { ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/utils";

/**
 * A form bound to a Server Action that returns `ActionResult`.
 *
 * Submission goes through `onSubmit` + `startTransition` rather than the bare
 * `action` prop. React 19 resets a form after every action submission, which
 * would wipe a long form the moment one field failed validation; dispatching
 * manually keeps what the user typed and resets only on success when asked.
 *
 * Field components read errors and pending state from context, so a page
 * composes plain `<TextField name="…" />` elements and never threads state.
 */

export type FormAction<T> = (
  state: ActionResult<T>,
  formData: FormData,
) => Promise<ActionResult<T>>;

type FormContextValue = {
  fieldErrors?: Record<string, string[]>;
  pending: boolean;
};

const FormContext = createContext<FormContextValue>({ pending: false });

export function useFormContext(): FormContextValue {
  return useContext(FormContext);
}

/** Data a successful action may return that the form knows how to present. */
export type FormSuccessData = {
  credentials?: { email: string; password: string; label?: string };
  /** A value shown once and never retrievable again, such as an API token. */
  secret?: { label: string; value: string; hint?: string };
};

function fieldOf<K extends keyof FormSuccessData>(data: unknown, key: K): FormSuccessData[K] {
  if (typeof data !== "object" || data === null || !(key in data)) return undefined;
  return (data as FormSuccessData)[key];
}

export function ActionForm<T>({
  action,
  children,
  className,
  resetOnSuccess = false,
}: {
  action: FormAction<T>;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, dispatch, pending] = useActionState(action, {
    status: "idle",
  } as ActionResult<T>);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") {
      if (state.message) toast.success(state.message);
      if (resetOnSuccess) formRef.current?.reset();
    }
  }, [state, resetOnSuccess]);

  const fieldErrors = state.status === "error" ? state.fieldErrors : undefined;
  const hasFieldErrors = Boolean(fieldErrors && Object.keys(fieldErrors).length);
  const formError = state.status === "error" ? state.message : undefined;
  const credentials = state.status === "success" ? fieldOf(state.data, "credentials") : undefined;
  const secret = state.status === "success" ? fieldOf(state.data, "secret") : undefined;

  return (
    <FormContext.Provider value={{ fieldErrors, pending }}>
      <form
        ref={formRef}
        noValidate
        className={cn("flex flex-col gap-5", className)}
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          startTransition(() => dispatch(formData));
        }}
      >
        {formError ? (
          <div
            role="alert"
            className="border-destructive/30 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm"
          >
            {formError}
            {hasFieldErrors && fieldErrors?._form ? ` ${fieldErrors._form[0]}` : null}
          </div>
        ) : null}

        {credentials ? <CredentialsNotice {...credentials} /> : null}
        {secret ? <SecretNotice {...secret} /> : null}

        {children}
      </form>
    </FormContext.Provider>
  );
}
