import { z } from "zod";

import { id, optionalId, optionalText } from "@/lib/validation/common";

/**
 * Student support — shared by forms, Server Actions and the API.
 *
 * The words here are about help, never about the child: "needs more
 * practice", not "weak". Labels live in the i18n dictionaries
 * (`support.reason.*`, `support.action.*`, `support.status.*`).
 */

export const SUPPORT_REASONS = [
  "DIFFICULTY_UNDERSTANDING",
  "LOW_TEST_PERFORMANCE",
  "HOMEWORK_INCOMPLETE",
  "LOW_PARTICIPATION",
  "ATTENDANCE",
  "NEEDS_PRACTICE",
  "NEEDS_REVISION",
  "LEARNING_GAP",
  "PARENT_CONCERN",
  "OTHER",
] as const;
/** The reasons a parent can pick: what they notice at home. */
export const CONCERN_REASONS = ["DIFFICULTY_UNDERSTANDING", "HOMEWORK_INCOMPLETE", "NEEDS_PRACTICE", "LOW_TEST_PERFORMANCE", "OTHER"] as const;
export const SUPPORT_ACTIONS = ["EXTRA_PRACTICE", "STUDY_MATERIAL", "REVISION", "EXTRA_CLASS", "ONE_TO_ONE", "HOMEWORK_SUPPORT", "PARENT_DISCUSSION", "MONITOR", "OTHER"] as const;
export const SUPPORT_PRIORITIES = ["LOW", "MEDIUM", "HIGH"] as const;
export const SUPPORT_STATUSES = ["NEW", "REVIEWING", "SUPPORT_PLANNED", "IN_PROGRESS", "IMPROVING", "RESOLVED"] as const;
/** Everything except RESOLVED: the records that still need something done. */
export const OPEN_SUPPORT = ["NEW", "REVIEWING", "SUPPORT_PLANNED", "IN_PROGRESS", "IMPROVING"] as const;
export const CONCERN_STATUSES = ["NEW", "REVIEWING", "ACTION_TAKEN", "RESOLVED"] as const;
export const SUPPORT_SOURCES = ["TEACHER", "PARENT", "SCHOOL_ADMIN"] as const;

export const supportSchema = z
  .object({
    studentId: id,
    subjectId: optionalId,
    reason: z.enum(SUPPORT_REASONS, { error: "Choose a reason" }),
    reasonNote: optionalText(300),
    topic: optionalText(120),
    priority: z.enum(SUPPORT_PRIORITIES).default("MEDIUM"),
    action: z.enum(SUPPORT_ACTIONS, { error: "Choose what will be done" }),
    actionNote: optionalText(500),
    /** Set when this support answers a parent's concern. */
    concernId: optionalId,
    /** School Admin only: which teacher looks after it. Ignored for teachers (it is always themselves). */
    teacherId: optionalId,
  })
  .refine((data) => data.reason !== "OTHER" || Boolean(data.reasonNote), { message: "Say a few words about the reason", path: ["reasonNote"] });
export type SupportInput = z.infer<typeof supportSchema>;

export const supportFollowUpSchema = z
  .object({
    supportId: id,
    note: optionalText(1000),
    status: z.enum(SUPPORT_STATUSES).optional(),
    priority: z.enum(SUPPORT_PRIORITIES).optional(),
    action: z.enum(SUPPORT_ACTIONS).optional(),
  })
  .refine((data) => Boolean(data.note || data.status || data.priority || data.action), { message: "Write a follow-up or choose a change", path: ["note"] });
export type SupportFollowUpInput = z.infer<typeof supportFollowUpSchema>;

export const concernSchema = z.object({
  studentId: id,
  subjectId: optionalId,
  reason: z.enum(CONCERN_REASONS, { error: "Choose what you have noticed" }),
  message: optionalText(600),
});
export type ConcernInput = z.infer<typeof concernSchema>;

export const concernReviewSchema = z.object({
  concernId: id,
  status: z.enum(["REVIEWING", "ACTION_TAKEN", "RESOLVED"]),
  /** What the parent is told. */
  response: optionalText(600),
});
export type ConcernReviewInput = z.infer<typeof concernReviewSchema>;
