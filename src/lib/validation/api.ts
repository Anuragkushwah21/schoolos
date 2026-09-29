import { z } from "zod";

import { GENDERS, STUDENT_STATUSES, TEACHER_STATUSES } from "@/lib/validation/school";
import { NOTICE_STATUSES } from "@/lib/validation/communication";
import { PLATFORM_AUDIT_ACTIONS } from "@/lib/audit-actions";
import { parseDateInput } from "@/lib/dates";

/**
 * Query-string schemas for the REST API.
 *
 * Query values are always strings, and anything unrecognised is rejected
 * rather than ignored: a caller who mistypes `?status=activ` should be told,
 * not handed the unfiltered list.
 */

const trimmed = z.string().trim().max(200);

export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).max(10_000).optional(),
});

export const dateQuery = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date in YYYY-MM-DD form")
  .transform((value, ctx) => {
    const date = parseDateInput(value);
    if (!date) {
      ctx.addIssue({ code: "custom", message: "That date does not exist" });
      return z.NEVER;
    }
    return date;
  });

export const studentsQuery = pageQuery.extend({
  q: trimmed.optional(),
  section: trimmed.optional(),
  class: trimmed.optional(),
  status: z.enum(STUDENT_STATUSES).optional(),
  gender: z.enum(GENDERS).optional(),
});

export const teachersQuery = pageQuery.extend({
  q: trimmed.optional(),
  status: z.enum(TEACHER_STATUSES).optional(),
});

export const guardiansQuery = z.object({ q: trimmed.optional() });

export const sectionsQuery = z.object({ session: trimmed.optional() });

export const timetableQuery = z.object({
  section: trimmed.optional(),
  teacher: trimmed.optional(),
  room: trimmed.optional(),
  session: trimmed.optional(),
});

export const registerQuery = z.object({ section: trimmed, date: dateQuery.optional() });

export const staffRegisterQuery = z.object({ date: dateQuery.optional() });

export const reportQuery = z.object({
  section: trimmed.optional(),
  from: dateQuery.optional(),
  to: dateQuery.optional(),
});

export const holidaysQuery = z
  .object({ from: dateQuery.optional(), to: dateQuery.optional() })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: "`from` must be on or before `to`",
    path: ["to"],
  });

export const noticesQuery = z.object({ status: z.enum(NOTICE_STATUSES).optional() });

export const admissionsQuery = z.object({
  status: z.enum(["SUBMITTED", "UNDER_REVIEW", "WAITLISTED", "ACCEPTED", "REJECTED"]).optional(),
});

export const schoolsQuery = pageQuery.extend({
  q: trimmed.optional(),
  status: z
    .enum(["REVIEW", "PENDING", "UNDER_REVIEW", "ACTIVE", "REJECTED", "SUSPENDED", "INACTIVE"])
    .optional(),
});

export const auditQuery = pageQuery.extend({
  q: trimmed.optional(),
  schoolId: trimmed.optional(),
  action: z.enum(PLATFORM_AUDIT_ACTIONS).optional(),
});

/** Parent portal reads. None of these carries a `parentId` or a `schoolId`. */
export const childActivityQuery = z.object({
  subject: trimmed.optional(),
  days: z.coerce.number().int().min(1).max(365).optional(),
});

export const childReportQuery = z.object({
  period: z.enum(["day", "week", "month"]).optional(),
});

export const childFocusQuery = z.object({
  child: trimmed.optional(),
});

export const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).optional() });

/** Flag-only updates, where a full replacement would be silly. */
export const activeBody = z.object({ isActive: z.boolean() });

export const apiTokenBody = z.object({
  name: z.string().trim().min(1, "Give the token a name").max(60),
  scope: z.enum(["READ", "FULL"]).default("READ"),
  expiresAt: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date in YYYY-MM-DD form")
    .optional()
    .transform((value) => (value ? parseDateInput(value) : null)),
});
