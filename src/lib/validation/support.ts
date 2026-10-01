import { z } from "zod";

import { id, optionalId, optionalText, requiredText } from "@/lib/validation/common";

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
export const SUPPORT_ACTIONS = ["EXTRA_PRACTICE", "STUDY_MATERIAL", "REVISION", "EXTRA_CLASS", "ONE_TO_ONE", "HOMEWORK_SUPPORT", "PARENT_DISCUSSION", "MONITOR", "OTHER"] as const;
export const SUPPORT_PRIORITIES = ["LOW", "MEDIUM", "HIGH"] as const;
export const SUPPORT_STATUSES = ["NEW", "REVIEWING", "SUPPORT_PLANNED", "IN_PROGRESS", "IMPROVING", "RESOLVED"] as const;
/** Everything except RESOLVED: the records that still need something done. */
export const OPEN_SUPPORT = ["NEW", "REVIEWING", "SUPPORT_PLANNED", "IN_PROGRESS", "IMPROVING"] as const;
/** Parent–teacher concerns: OPEN → IN_PROGRESS → RESOLVED. (CLOSED exists in the database for old rows only.) */
export const CONCERN_STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED"] as const;
/** Still being worked on. */
export const OPEN_CONCERN = ["OPEN", "IN_PROGRESS"] as const;
/** What a concern is about. Descriptive — never a label on the child. */
export const CONCERN_TYPES = [
  "ACADEMIC",
  "TOPIC_DIFFICULTY",
  "HOMEWORK",
  "ATTENDANCE",
  "PARTICIPATION",
  "EXTRA_SUPPORT",
  "IMPROVEMENT_SUGGESTION",
  "POSITIVE_FEEDBACK",
  "OTHER",
] as const;
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

/**
 * A parent raises a concern about one child and one subject. There is no
 * teacher field: the school decides who receives it from the child's class,
 * section, stream and subject.
 */
export const parentConcernSchema = z.object({
  studentId: id,
  subjectId: id,
  type: z.enum(CONCERN_TYPES).default("ACADEMIC"),
  message: requiredText("your concern", 2000),
});
export type ParentConcernInput = z.infer<typeof parentConcernSchema>;

/** A teacher raises a concern for a student's parents, in a subject they teach that student. */
export const teacherConcernSchema = z.object({
  studentId: id,
  subjectId: id,
  type: z.enum(CONCERN_TYPES).default("ACADEMIC"),
  priority: z.enum(SUPPORT_PRIORITIES).default("MEDIUM"),
  message: requiredText("your concern", 2000),
});
export type TeacherConcernInput = z.infer<typeof teacherConcernSchema>;

/** Staff move a concern along (status), optionally with a short note. */
export const concernReplySchema = z
  .object({
    concernId: id,
    message: optionalText(2000),
    status: z.preprocess((value) => (value === "" ? undefined : value), z.enum(CONCERN_STATUSES).optional()),
    priority: z.preprocess((value) => (value === "" ? undefined : value), z.enum(SUPPORT_PRIORITIES).optional()),
  })
  .refine((data) => Boolean(data.message || data.status || data.priority), { message: "Write a reply or choose a change", path: ["message"] });
export type ConcernReplyInput = z.infer<typeof concernReplySchema>;

/** The School Admin asks the teacher for an update. */
export const concernUpdateRequestSchema = z.object({
  concernId: id,
  note: optionalText(600),
});
export type ConcernUpdateRequestInput = z.infer<typeof concernUpdateRequestSchema>;

/** The School Admin hands a concern to a teacher (e.g. one waiting with the office). */
export const concernAssignSchema = z.object({
  concernId: id,
  teacherId: id,
});
export type ConcernAssignInput = z.infer<typeof concernAssignSchema>;
