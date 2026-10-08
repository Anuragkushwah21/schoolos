import { z } from "zod";

import { spanDays } from "@/lib/calendar";
import { id, optionalDate, optionalId, optionalText, requiredDate, requiredInt, requiredText } from "@/lib/validation/common";

/**
 * Exams and marks. Shared by the forms, the server actions and the API.
 *
 * Exam and class-test dates may be in the past or the future: an exam is set
 * ahead of time, and a test already held is entered afterwards.
 */

const MAX_EXAM_DAYS = 60;

const paperSchema = z
  .object({
    subjectId: id,
    maxMarks: requiredInt(1, 1000),
    passMarks: z.preprocess(
      (value) => (value === "" || value === null ? undefined : value),
      z.coerce.number().int("Enter a whole number").min(0, "Must be at least 0").optional(),
    ),
    date: optionalDate,
  })
  .refine((paper) => paper.passMarks === undefined || paper.passMarks <= paper.maxMarks, {
    message: "Pass marks cannot be more than the maximum",
    path: ["passMarks"],
  });

/** The papers arrive from the form as one JSON field; the API sends an array. */
const papersField = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  },
  z.array(paperSchema, { error: "Add at least one subject" }).min(1, "Add at least one subject").max(20),
);

/** One or several sections: a checkbox group submits a string or an array. */
const idList = z.preprocess(
  (value) => (value === undefined || value === "" ? [] : Array.isArray(value) ? value : [value]),
  z.array(id).min(1, "Choose at least one section").max(60),
);

export const createExamSchema = z
  .object({
    name: requiredText("the exam name, e.g. Half-Yearly", 80),
    sectionIds: idList,
    startDate: requiredDate("the first day of the exam"),
    endDate: requiredDate("the last day of the exam"),
    papers: papersField,
  })
  .superRefine((data, ctx) => {
    if (data.endDate < data.startDate) {
      ctx.addIssue({ code: "custom", message: "The exam cannot end before it starts", path: ["endDate"] });
      return;
    }
    if (spanDays(data.startDate, data.endDate) > MAX_EXAM_DAYS) {
      ctx.addIssue({ code: "custom", message: `An exam can run at most ${MAX_EXAM_DAYS} days`, path: ["endDate"] });
    }
    const seen = new Set<string>();
    data.papers.forEach((paper, index) => {
      if (seen.has(paper.subjectId)) {
        ctx.addIssue({ code: "custom", message: "Each subject can appear once", path: ["papers", index, "subjectId"] });
      }
      seen.add(paper.subjectId);
      if (paper.date && (paper.date < data.startDate || paper.date > data.endDate)) {
        ctx.addIssue({
          code: "custom",
          message: "A paper's date must fall within the exam dates",
          path: ["papers", index, "date"],
        });
      }
    });
  });

export type CreateExamInput = z.infer<typeof createExamSchema>;

export const updateExamSchema = z
  .object({
    examId: id,
    name: requiredText("the exam name", 80),
    startDate: requiredDate("the first day of the exam"),
    endDate: requiredDate("the last day of the exam"),
  })
  .refine((data) => data.endDate >= data.startDate, {
    message: "The exam cannot end before it starts",
    path: ["endDate"],
  });

export type UpdateExamInput = z.infer<typeof updateExamSchema>;

export const classTestSchema = z
  .object({
    sectionId: id,
    subjectId: id,
    /** Blank = the whole section; otherwise the stream the teacher is assigned to teach. */
    streamId: optionalId,
    description: optionalText(500),
    name: requiredText("a name, e.g. Unit Test 2", 80),
    date: requiredDate("the date of the test"),
    maxMarks: requiredInt(1, 1000),
    passMarks: z.preprocess(
      (value) => (value === "" || value === null ? undefined : value),
      z.coerce.number().int("Enter a whole number").min(0).optional(),
    ),
  })
  .refine((data) => data.passMarks === undefined || data.passMarks <= data.maxMarks, {
    message: "Pass marks cannot be more than the maximum",
    path: ["passMarks"],
  });

export type ClassTestInput = z.infer<typeof classTestSchema>;

/** Editing a test: its subject, class, section and stream stay as set. */
export const updateClassTestSchema = z.object({
  assessmentId: id,
  name: requiredText("a name, e.g. Unit Test 2", 80),
  date: requiredDate("the date of the test"),
  maxMarks: requiredInt(1, 1000),
  description: optionalText(500),
});
export type UpdateClassTestInput = z.infer<typeof updateClassTestSchema>;

export const reopenMarksSchema = z.object({
  assessmentId: id,
  reason: requiredText("why the marks need correcting", 300),
});

export type MarkEntry = { studentId: string; marks: number | null; absent: boolean; remark: string | null; /** Excused from this paper: no mark, left out of totals. */ exempt?: boolean };

/** The API's marks body. Range checks against the paper happen in the service. */
export const marksBodySchema = z.object({
  entries: z
    .array(
      z.object({
        studentId: id,
        marks: z.number().int("Marks are whole numbers").min(0).nullable().optional(),
        absent: z.boolean().optional(),
        exempt: z.boolean().optional(),
        remark: optionalText(300),
      }),
    )
    .min(1, "Send at least one entry")
    .max(500),
});

export const examIdsSchema = z.object({
  examIds: z.preprocess(
    (value) => (value === undefined || value === "" ? [] : Array.isArray(value) ? value : [value]),
    z.array(id).min(1, "Choose at least one exam").max(100),
  ),
});

/** Withdrawing published results always says why (it is on the audit log). */
export const unpublishExamSchema = z.object({ examId: id, reason: requiredText("why the results are being withdrawn", 300) });

/** Correcting one published mark: the new value and the reason. */
export const correctResultSchema = z.object({
  assessmentId: id,
  studentId: id,
  marks: z.preprocess((value) => (value === "" || value === undefined || value === null ? null : value), z.coerce.number().int("Marks are whole numbers").min(0).nullable()),
  status: z.enum(["MARKS", "ABSENT", "EXEMPT"]).default("MARKS"),
  reason: requiredText("why the mark is being corrected", 300),
});

/** The school's grading scale: one "grade:min" pair per line ("A1:91"), highest first. */
export const gradingRulesSchema = z.object({
  useDefault: z.preprocess((value) => value === "on" || value === "true" || value === true, z.boolean()).default(false),
  bands: z.string().max(1000).optional().default(""),
  passPercent: z.coerce.number({ error: "Enter a pass percentage" }).int("Whole percent").min(1).max(100),
});

/** The final-result scheme: one "exam name:weight" pair per line. */
export const resultSchemeSchema = z.object({
  name: requiredText("a name for the final result", 80),
  components: requiredText("the exams and their weights", 2000),
});
