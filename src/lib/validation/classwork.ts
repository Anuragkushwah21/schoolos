import { z } from "zod";

import {
  id,
  optionalEnum,
  optionalId,
  optionalUrl,
  optionalText,
  requiredDate,
  requiredText,
} from "@/lib/validation/common";

/**
 * What a teacher records about their teaching: the lesson, the homework, the
 * note about a child.
 *
 * None of these carry a `schoolId` or a `teacherId`. Both come from the
 * session on the server, so no request can claim to be someone else's.
 */

/** Mirrors `ACTIVITY_STATUSES`; `SCHEDULED` is the absence of a record. */
export const ACTIVITY_STATUS_VALUES = [
  "COMPLETED",
  "SUBSTITUTE",
  "REMOTE",
  "MISSED",
  "CANCELLED",
] as const;

export const activitySchema = z.object({
  /** The period being written up. It already names the class and the teacher. */
  timetableSlotId: id,
  date: requiredDate("the date of the class"),
  status: z.enum(ACTIVITY_STATUS_VALUES, { error: "Choose what happened" }),
  topic: optionalText(160),
  notes: optionalText(2000),
  /** The short list a student revises from. */
  importantPoints: optionalText(1000),
});

export type ActivityInput = z.infer<typeof activitySchema>;

/**
 * Planning a lesson before it happens, so students can prepare.
 *
 * The same period as an activity, addressed the same way. At least one of the
 * two fields must say something — the service checks that too, because an empty
 * plan is a row a student cannot act on.
 */
export const lessonPlanSchema = z
  .object({
    timetableSlotId: id,
    date: requiredDate("the date of the lesson"),
    plannedTopic: optionalText(160),
    preparation: optionalText(1000),
  })
  .refine((data) => Boolean(data.plannedTopic || data.preparation), {
    message: "Give the lesson a topic, or something to prepare.",
    path: ["plannedTopic"],
  });

export type LessonPlanInput = z.infer<typeof lessonPlanSchema>;

export const MATERIAL_KIND_VALUES = [
  "NOTES",
  "LINK",
  "DOCUMENT",
  "QUESTIONS",
  "PRACTICE",
] as const;

/** Kinds that carry a web address rather than text the teacher typed. */
const URL_KIND_VALUES: readonly string[] = ["LINK", "DOCUMENT"];

export const lessonMaterialSchema = z
  .object({
    classSessionId: id,
    kind: z.enum(MATERIAL_KIND_VALUES, { error: "Choose a kind" }),
    title: requiredText("a title", 160),
    url: optionalUrl,
    body: optionalText(4000),
  })
  .refine((data) => !URL_KIND_VALUES.includes(data.kind) || Boolean(data.url), {
    message: "A link or a document needs a web address",
    path: ["url"],
  })
  .refine((data) => URL_KIND_VALUES.includes(data.kind) || Boolean(data.body), {
    message: "Write the notes, questions or practice work itself",
    path: ["body"],
  });

export type LessonMaterialInput = z.infer<typeof lessonMaterialSchema>;

export const HOMEWORK_STATUS_VALUES = ["DRAFT", "PUBLISHED"] as const;

export const homeworkSchema = z
  .object({
    homeworkId: optionalId,
    sectionId: id,
    subjectId: id,
    title: requiredText("a title", 160),
    description: optionalText(4000),
    assignedOn: requiredDate("the date it is set"),
    dueOn: requiredDate("a due date"),
    status: z.enum(HOMEWORK_STATUS_VALUES, { error: "Choose a status" }),
  })
  .refine((data) => data.dueOn >= data.assignedOn, {
    message: "The due date cannot be before the date it is set",
    path: ["dueOn"],
  });

export type HomeworkInput = z.infer<typeof homeworkSchema>;

/**
 * The three bands a remark answers, and the words that go with them.
 *
 * Structured rather than free prose: a parent reading a year of remarks sees
 * the same three questions answered each time instead of a teacher's varying
 * phrasing, and a fixed vocabulary keeps anything beyond those questions off a
 * child's record. The note stays, because a band alone cannot say "struggled
 * with fractions this week".
 */
export const REMARK_LEVELS = ["GOOD", "AVERAGE", "NEEDS_ATTENTION"] as const;
export const HOMEWORK_HABITS = ["REGULAR", "SOMETIMES_MISSING", "FREQUENTLY_MISSING"] as const;
export const PARTICIPATION_LEVELS = ["ACTIVE", "AVERAGE", "NEEDS_IMPROVEMENT"] as const;

const remarkBands = {
  understanding: optionalEnum(REMARK_LEVELS),
  homeworkHabit: optionalEnum(HOMEWORK_HABITS),
  participation: optionalEnum(PARTICIPATION_LEVELS),
  note: optionalText(1000),
};

/** An empty remark says nothing and should not reach a child's record. */
const HAS_CONTENT = {
  message: "Answer at least one of the three, or write a note.",
  path: ["note"],
};

function hasContent(data: {
  understanding?: string | null;
  homeworkHabit?: string | null;
  participation?: string | null;
  note?: string | null;
}): boolean {
  return Boolean(data.understanding || data.homeworkHabit || data.participation || data.note);
}

export const remarkSchema = z
  .object({
    studentId: id,
    subjectId: optionalId,
    ...remarkBands,
  })
  .refine(hasContent, HAS_CONTENT);

export type RemarkInput = z.infer<typeof remarkSchema>;

export const remarkEditSchema = z
  .object({
    remarkId: id,
    ...remarkBands,
  })
  .refine(hasContent, HAS_CONTENT);

export type RemarkEditInput = z.infer<typeof remarkEditSchema>;
