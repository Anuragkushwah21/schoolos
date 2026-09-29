import { z } from "zod";

import {
  id,
  optionalDate,
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

export const activitySchema = z
  .object({
    /** The period being written up. It already names the class and the teacher. */
    timetableSlotId: id,
    date: requiredDate("the date of the class"),
    status: z.enum(ACTIVITY_STATUS_VALUES, { error: "Choose what happened" }),
    topic: optionalText(160),
    notes: optionalText(2000),
    /** The short list a student revises from. */
    importantPoints: optionalText(1000),
    /** What students should do before the next class. */
    preparation: optionalText(1000),
    /** Homework set in this class. Title and due date go together. */
    homeworkTitle: optionalText(160),
    homeworkDescription: optionalText(2000),
    homeworkDueOn: optionalDate,
  })
  .refine((data) => !data.homeworkTitle || Boolean(data.homeworkDueOn), {
    message: "Give the homework a due date",
    path: ["homeworkDueOn"],
  })
  .refine((data) => !data.homeworkDueOn || !data.homeworkTitle || data.homeworkDueOn >= data.date, {
    message: "Homework cannot be due before the class",
    path: ["homeworkDueOn"],
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
  "VIDEO",
] as const;

/** Kinds that carry a web address rather than text the teacher typed. */
const URL_KIND_VALUES: readonly string[] = ["LINK", "DOCUMENT", "VIDEO"];

/**
 * An optional uploaded file. A file input left empty still posts an empty
 * `File`, which is read here as "no file". Type and size are checked by the
 * storage service, which also reads the bytes.
 */
const optionalFile = z.preprocess(
  (value) => (value instanceof File && value.size > 0 ? value : undefined),
  z.instanceof(File).optional(),
);

export const lessonMaterialSchema = z
  .object({
    classSessionId: id,
    kind: z.enum(MATERIAL_KIND_VALUES, { error: "Choose a kind" }),
    title: requiredText("a title", 160),
    url: optionalUrl,
    body: optionalText(4000),
    description: optionalText(500),
    file: optionalFile,
  })
  .refine(
    (data) =>
      !URL_KIND_VALUES.includes(data.kind) ||
      Boolean(data.url) ||
      (data.kind === "DOCUMENT" && Boolean(data.file)),
    {
      message: "Give a web address, or upload a PDF for a document",
      path: ["url"],
    },
  )
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
    /** Step-by-step: "Complete Exercise 4.2, Questions 1-10." */
    instructions: optionalText(4000),
    assignedOn: requiredDate("the date it is set"),
    dueOn: requiredDate("a due date"),
    status: z.enum(HOMEWORK_STATUS_VALUES, { error: "Choose a status" }),
  })
  .refine((data) => data.dueOn >= data.assignedOn, {
    message: "The due date cannot be before the date it is set",
    path: ["dueOn"],
  });

export type HomeworkInput = z.infer<typeof homeworkSchema>;

/** What can be attached to homework. Notes belong in the instructions. */
export const HOMEWORK_RESOURCE_KIND_VALUES = ["DOCUMENT", "VIDEO", "LINK"] as const;

const homeworkResourceFields = {
  kind: z.enum(HOMEWORK_RESOURCE_KIND_VALUES, { error: "Choose a resource type" }),
  title: requiredText("a title", 160),
  url: optionalUrl,
  description: optionalText(500),
  file: optionalFile,
};

function hasTarget(data: { kind: string; url: string | null; file?: File }): boolean {
  return Boolean(data.url) || (data.kind === "DOCUMENT" && Boolean(data.file));
}

const TARGET_MESSAGE = {
  message: "Upload a PDF, or give an https:// web address",
  path: ["url"],
};

export const homeworkResourceSchema = z.object(homeworkResourceFields).refine(hasTarget, TARGET_MESSAGE);

export const addHomeworkResourceSchema = z
  .object({ homeworkId: id, ...homeworkResourceFields })
  .refine(hasTarget, TARGET_MESSAGE);

export const updateHomeworkResourceSchema = z.object({
  resourceId: id,
  title: requiredText("a title", 160),
  url: optionalUrl,
  description: optionalText(500),
  file: optionalFile,
});

/**
 * The resource rows of the create-homework form, posted as
 * `resources.<n>.kind`, `resources.<n>.title` and so on.
 *
 * Each row is validated on its own, and an error is reported against that
 * row's own field (`resources.2.url`), so the form can show it in place.
 */
export function parseHomeworkResources(formData: FormData): {
  resources: Array<z.infer<typeof homeworkResourceSchema>>;
  fieldErrors: Record<string, string[]>;
} {
  const indices = new Set<string>();
  for (const key of formData.keys()) {
    const match = /^resources\.(\d+)\./.exec(key);
    if (match) indices.add(match[1]!);
  }

  const resources: Array<z.infer<typeof homeworkResourceSchema>> = [];
  const fieldErrors: Record<string, string[]> = {};

  for (const index of [...indices].sort((a, b) => Number(a) - Number(b))) {
    // A field the row does not have (a PDF row has no URL) is absent, not null.
    const field = (name: string) => formData.get(`resources.${index}.${name}`) ?? undefined;
    const raw = {
      kind: field("kind"),
      title: field("title"),
      url: field("url"),
      description: field("description"),
      file: field("file"),
    };
    const parsed = homeworkResourceSchema.safeParse(raw);
    if (parsed.success) {
      resources.push(parsed.data);
    } else {
      for (const issue of parsed.error.issues) {
        (fieldErrors[`resources.${index}.${issue.path.join(".")}`] ??= []).push(issue.message);
      }
    }
  }

  return { resources, fieldErrors };
}

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
