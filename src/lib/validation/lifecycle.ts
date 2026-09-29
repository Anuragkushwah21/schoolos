import { z } from "zod";

import { id, optionalText, requiredDate } from "@/lib/validation/common";

/**
 * People lifecycle — JOIN → ACTIVE → status change → access → history kept.
 *
 * A person's status (are they still at the school?) and their login (may they
 * sign in?) are separate things, stored separately. These lists say which
 * statuses count as "current" and which close portal access; the server
 * enforces them, the screens only describe them.
 */

export const STUDENT_LIFECYCLE = ["ACTIVE", "ON_LEAVE", "TRANSFERRED", "GRADUATED", "WITHDRAWN", "INACTIVE"] as const;
export const EMPLOYEE_LIFECYCLE = ["ACTIVE", "ON_LEAVE", "SUSPENDED", "RESIGNED", "TERMINATED", "RETIRED", "TRANSFERRED", "INACTIVE"] as const;

export type StudentLifecycle = (typeof STUDENT_LIFECYCLE)[number];
export type EmployeeLifecycle = (typeof EMPLOYEE_LIFECYCLE)[number];

/** Still part of the school today: counted, listed, and able to sign in. */
export const CURRENT_STUDENT: readonly StudentLifecycle[] = ["ACTIVE", "ON_LEAVE"];
export const CURRENT_EMPLOYEE: readonly EmployeeLifecycle[] = ["ACTIVE", "ON_LEAVE"];

/** Has left the school. Their records stay; their login closes. */
export const LEFT_STUDENT: readonly StudentLifecycle[] = ["TRANSFERRED", "GRADUATED", "WITHDRAWN", "INACTIVE"];
/** Has left employment. SUSPENDED is not here: they have not left, but they may not sign in. */
export const LEFT_EMPLOYEE: readonly EmployeeLifecycle[] = ["RESIGNED", "TERMINATED", "RETIRED", "TRANSFERRED", "INACTIVE"];

export function studentMaySignIn(status: string): boolean {
  return (CURRENT_STUDENT as readonly string[]).includes(status);
}

export function employeeMaySignIn(status: string): boolean {
  return (CURRENT_EMPLOYEE as readonly string[]).includes(status);
}

/** What a login looks like to the office. NO_LOGIN: never issued. */
export type LoginState = "NO_LOGIN" | "ACTIVE" | "DISABLED" | "LOCKED";

/**
 * ACTIVE — the person may sign in. DISABLED — the office closed it.
 * LOCKED — closed because of the person's status (e.g. transferred); it
 * reopens by itself if they return.
 */
export function loginState(user: { isActive: boolean; disabledReason: "ADMIN" | "STATUS" | null } | null): LoginState {
  if (!user) return "NO_LOGIN";
  if (user.isActive) return "ACTIVE";
  return user.disabledReason === "STATUS" ? "LOCKED" : "DISABLED";
}

export const PERSON_KINDS = ["STUDENT", "PARENT", "TEACHER", "STAFF"] as const;
export type PersonKindValue = (typeof PERSON_KINDS)[number];

export const statusChangeSchema = z.object({
  person: z.enum(["STUDENT", "TEACHER", "STAFF"]),
  personId: id,
  status: z.string().trim().min(1, "Choose the new status"),
  /** The day it took effect: a leaving date, a last working day, a return date. */
  effectiveDate: requiredDate("the date it takes effect"),
  reason: optionalText(200),
  remarks: optionalText(1000),
  /** Bringing back someone who had left is allowed, but must be meant. */
  confirmReturn: z
    .preprocess((value) => value === true || value === "on" || value === "true", z.boolean())
    .default(false),
});
export type StatusChangeInput = z.infer<typeof statusChangeSchema>;

export const loginAccessSchema = z.object({
  person: z.enum(PERSON_KINDS),
  personId: id,
  enabled: z.preprocess((value) => value === true || value === "true", z.boolean()),
  reason: optionalText(200),
});
export type LoginAccessInput = z.infer<typeof loginAccessSchema>;
