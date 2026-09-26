import { z } from "zod";

import { parseDateInput, timeToMinutes } from "@/lib/dates";

/**
 * Building blocks for form schemas.
 *
 * `FormData` delivers every value as a string, and an untouched optional input
 * arrives as "" rather than being absent. These helpers normalise that once so
 * individual schemas can say what they mean.
 */

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

export function requiredText(label: string, max = 200) {
  return z
    .string({ error: `Enter ${label}` })
    .trim()
    .min(1, `Enter ${label}`)
    .max(max, `Keep ${label} under ${max} characters`);
}

/** An optional free-text field. Blank becomes `null` so it clears the column. */
export function optionalText(max = 500) {
  return z.preprocess(
    emptyToUndefined,
    z.string().trim().max(max, `Keep this under ${max} characters`).optional(),
  ).transform((value) => value ?? null);
}

/**
 * An optional `https://` link. Plain `http` is refused because a school page
 * served over TLS cannot load it, and there is no upload pipeline in V1 — every
 * document is a link to somewhere the school already hosts it.
 */
export const optionalUrl = z
  .preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .max(500, "Keep this under 500 characters")
      .regex(/^https:\/\//, "Use an https:// link")
      .optional(),
  )
  .transform((value) => value ?? null);

export const optionalEmail = z
  .preprocess(
    emptyToUndefined,
    z.email("Enter a valid email address").optional(),
  )
  .transform((value) => value?.toLowerCase() ?? null);

export const requiredEmail = z
  .string({ error: "Enter an email address" })
  .trim()
  .min(1, "Enter an email address")
  .pipe(z.email("Enter a valid email address"))
  .transform((value) => value.toLowerCase());

/** Indian phone numbers vary in formatting; accept digits, spaces, + and -. */
export const requiredPhone = z
  .string({ error: "Enter a phone number" })
  .trim()
  .min(1, "Enter a phone number")
  .regex(/^\+?[0-9][0-9\s-]{6,18}$/, "Enter a valid phone number");

export const optionalPhone = z
  .preprocess(emptyToUndefined, requiredPhone.optional())
  .transform((value) => value ?? null);

/**
 * A native checkbox submits "on" when ticked and nothing at all otherwise.
 * A JSON client sends a real boolean, so both are accepted.
 */
export const checkbox = z
  .preprocess((value) => value === true || value === "on" || value === "true", z.boolean())
  .default(false);

/** A record id from a hidden input or select. Ownership is checked by scope. */
export const id = z.string().trim().min(1, "Choose an option").max(64);

export const optionalId = z
  .preprocess(emptyToUndefined, id.optional())
  .transform((value) => value ?? null);

export function requiredDate(label = "a date") {
  return z
    .string({ error: `Enter ${label}` })
    .transform((value, ctx) => {
      const date = parseDateInput(value);
      if (!date) {
        ctx.addIssue({ code: "custom", message: `Enter ${label}` });
        return z.NEVER;
      }
      return date;
    });
}

export const optionalDate = z
  .preprocess(emptyToUndefined, requiredDate().optional())
  .transform((value) => value ?? null);

export function requiredTime(label = "a time") {
  return z
    .string({ error: `Enter ${label}` })
    .transform((value, ctx) => {
      const minutes = timeToMinutes(value);
      if (minutes === null) {
        ctx.addIssue({ code: "custom", message: `Enter ${label}` });
        return z.NEVER;
      }
      return minutes;
    });
}

export const optionalTime = z
  .preprocess(emptyToUndefined, requiredTime().optional())
  .transform((value) => value ?? null);

export function optionalInt(min: number, max: number) {
  return z
    .preprocess(
      emptyToUndefined,
      z.coerce
        .number({ error: "Enter a whole number" })
        .int("Enter a whole number")
        .min(min, `Must be at least ${min}`)
        .max(max, `Must be at most ${max}`)
        .optional(),
    )
    .transform((value) => value ?? null);
}

export function requiredInt(min: number, max: number) {
  return z.coerce
    .number({ error: "Enter a whole number" })
    .int("Enter a whole number")
    .min(min, `Must be at least ${min}`)
    .max(max, `Must be at most ${max}`);
}

/** An enum from a `<select>`, where "" means "not chosen". */
export function optionalEnum<const T extends readonly [string, ...string[]]>(values: T) {
  return z
    .preprocess(emptyToUndefined, z.enum(values).optional())
    .transform((value) => value ?? null);
}
