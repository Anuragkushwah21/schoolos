import { z } from "zod";

import { AppError, ValidationError, toSafeMessage } from "@/lib/errors";

/**
 * The single shape every Server Action returns.
 *
 * Actions never throw across the network boundary — they resolve to this
 * discriminated union, which `useActionState` renders directly. That keeps
 * raw errors on the server and gives every form the same error/field-error
 * handling.
 */
export type ActionResult<T = undefined> =
  | { status: "idle" }
  | { status: "success"; message?: string; data: T }
  | {
      status: "error";
      message: string;
      fieldErrors?: Record<string, string[]>;
    };

export const idleResult: ActionResult<never> = { status: "idle" };

export function successResult(message?: string): ActionResult<undefined>;
export function successResult<T>(message: string | undefined, data: T): ActionResult<T>;
export function successResult<T>(
  message?: string,
  data?: T,
): ActionResult<T | undefined> {
  return { status: "success", message, data };
}

export function errorResult(
  message: string,
  fieldErrors?: Record<string, string[]>,
): ActionResult<never> {
  return { status: "error", message, fieldErrors };
}

/**
 * Run a Server Action body and normalise every failure mode into
 * `ActionResult`.
 *
 * Validation errors keep their per-field detail; every other error is passed
 * through `toSafeMessage`, so database and runtime errors are logged on the
 * server and surfaced to the user as a generic message.
 */
export async function runAction<T>(
  fn: () => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ValidationError) {
      return errorResult(error.message, error.fieldErrors);
    }

    if (error instanceof AppError) {
      return errorResult(error.message);
    }

    return errorResult(toSafeMessage(error));
  }
}

/**
 * Parse `FormData` with a Zod schema, raising a `ValidationError` that carries
 * per-field messages back to the form.
 */
export function parseFormData<S extends z.ZodType>(
  schema: S,
  formData: FormData,
): z.infer<S> {
  const raw: Record<string, FormDataEntryValue | FormDataEntryValue[]> = {};

  for (const key of new Set(formData.keys())) {
    const values = formData.getAll(key);
    raw[key] = values.length > 1 ? values : values[0];
  }

  const parsed = schema.safeParse(raw);

  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};

    for (const issue of parsed.error.issues) {
      const path = issue.path.join(".") || "_form";
      (fieldErrors[path] ??= []).push(issue.message);
    }

    throw new ValidationError("Please correct the highlighted fields.", fieldErrors);
  }

  return parsed.data;
}
