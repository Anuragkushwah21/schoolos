"use server";

import type { Route } from "next";
import { z } from "zod";

import { type ActionResult, errorResult, parseFormData, successResult } from "@/lib/action-result";
import { ValidationError } from "@/lib/errors";
import { id } from "@/lib/validation/common";
import { classTestSchema, correctResultSchema, createExamSchema, examIdsSchema, gradingRulesSchema, resultSchemeSchema, type MarkEntry, reopenMarksSchema, unpublishExamSchema, updateClassTestSchema, updateExamSchema } from "@/lib/validation/exams";
import { requireTenantForAction } from "@/server/auth/current-user";
import {
  correctPublishedResult,
  createClassTest,
  createExams,
  deleteClassTest,
  deleteExam,
  type ImportError,
  importMarksCsv,
  publishExams,
  reopenMarks,
  saveMarks,
  submitMarks,
  unpublishExam,
  updateClassTest,
  updateExam,
  verifyExam,
} from "@/server/exams/service";
import { saveAttentionSettings } from "@/server/exams/attention";
import { saveSignalSettings } from "@/server/exams/student-signals";
import { parseComponents, saveResultScheme } from "@/server/exams/final-results";
import { saveGradingRules } from "@/server/exams/grading";
import { performAction } from "@/server/perform-action";

type Result = ActionResult<undefined>;

/** Results reach every portal, so all four areas are refreshed. */
const EXAM_PAGES = ["/school-admin", "/teacher", "/student", "/parent"];

const admin = () => requireTenantForAction("SCHOOL_ADMIN", "PRINCIPAL");

export async function createExamAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await admin();
      const { ids } = await createExams(ctx, parseFormData(createExamSchema, formData));
      return successResult(`Exam created for ${ids.length} section${ids.length === 1 ? "" : "s"}.`);
    },
    { revalidate: EXAM_PAGES, redirectTo: "/school-admin/exams/term" },
  );
}

export async function updateExamAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await admin();
      await updateExam(ctx, parseFormData(updateExamSchema, formData));
      return successResult("Exam updated.");
    },
    { revalidate: EXAM_PAGES },
  );
}

export async function deleteExamAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await admin();
      const { examId } = parseFormData(z.object({ examId: id }), formData);
      await deleteExam(ctx, examId);
      return successResult("Exam deleted.");
    },
    { revalidate: EXAM_PAGES, redirectTo: "/school-admin/exams/term" },
  );
}

export async function publishExamsAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await admin();
      const { examIds } = parseFormData(examIdsSchema, formData);
      const { published } = await publishExams(ctx, examIds);
      return successResult(published ? `Results published for ${published} exam${published === 1 ? "" : "s"}.` : "Already published.");
    },
    { revalidate: EXAM_PAGES },
  );
}

export async function unpublishExamAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await admin();
      const { examId, reason } = parseFormData(unpublishExamSchema, formData);
      await unpublishExam(ctx, examId, reason);
      return successResult("Results withdrawn. Marks can be corrected now; verify again before republishing.");
    },
    { revalidate: EXAM_PAGES },
  );
}

/** Marks arrive as `marks:<id>`, `status:<id>` (MARKS / ABSENT / EXEMPT; or the older `absent:<id>`) and `remark:<id>` per student row. */
function readMarks(formData: FormData): MarkEntry[] {
  const entries: MarkEntry[] = [];
  const errors: Record<string, string[]> = {};
  for (const key of formData.keys()) {
    if (!key.startsWith("row:")) continue;
    const studentId = key.slice("row:".length);
    const raw = String(formData.get(`marks:${studentId}`) ?? "").trim();
    const status = String(formData.get(`status:${studentId}`) ?? "");
    const absent = formData.get(`absent:${studentId}`) === "on" || status === "ABSENT";
    const exempt = status === "EXEMPT";
    const remark = String(formData.get(`remark:${studentId}`) ?? "").trim().slice(0, 300) || null;
    if (raw !== "" && !/^\d+$/.test(raw)) {
      errors[`marks:${studentId}`] = ["Enter a whole number"];
      continue;
    }
    entries.push({ studentId, marks: exempt || absent ? null : raw === "" ? null : Number(raw), absent: exempt ? false : absent, exempt, remark });
  }
  if (Object.keys(errors).length) throw new ValidationError("Some marks need correcting.", errors);
  return entries;
}

export async function saveMarksAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN", "PRINCIPAL", "TEACHER");
      const { assessmentId } = parseFormData(z.object({ assessmentId: id }), formData);
      // "Submit results" saves what is on screen first, then hands it in.
      if (formData.get("intent") === "submit") {
        const entries = readMarks(formData);
        if (entries.length) await saveMarks(ctx, assessmentId, entries);
        const { visibleNow } = await submitMarks(ctx, assessmentId);
        return successResult(
          visibleNow ? "Results submitted. Students and parents can see them now." : "Marks submitted. The school office publishes the exam results.",
        );
      }
      const { saved, cleared } = await saveMarks(ctx, assessmentId, readMarks(formData));
      return successResult(`Draft saved — marks for ${saved} student${saved === 1 ? "" : "s"}${cleared ? `, ${cleared} cleared` : ""}. Submit when everyone is marked.`);
    },
    { revalidate: EXAM_PAGES },
  );
}

export type ImportResult = ActionResult<{ errors: ImportError[] } | undefined>;

/** Import a filled-in marks template. Nothing is saved unless every row is valid. */
export async function importMarksAction(_p: ImportResult, formData: FormData): Promise<ImportResult> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN", "PRINCIPAL", "TEACHER");
      const { assessmentId } = parseFormData(z.object({ assessmentId: id }), formData);
      const file = formData.get("file");
      if (!(file instanceof File) || file.size === 0) return errorResult("Choose the CSV file to import.");
      if (file.size > 1_000_000) return errorResult("The file is too large. Import at most 500 rows at a time.");
      const result = await importMarksCsv(ctx, assessmentId, await file.text());
      if (result.errors.length) {
        return {
          status: "error",
          message: `Nothing was saved. Fix ${result.errors.length} row${result.errors.length === 1 ? "" : "s"} and import again.`,
          fieldErrors: Object.fromEntries(result.errors.map((error) => [`line ${error.line}`, [error.message]])),
        };
      }
      return successResult(`Imported marks for ${result.saved} student${result.saved === 1 ? "" : "s"}.`, undefined);
    },
    { revalidate: EXAM_PAGES },
  );
}

export async function createClassTestAction(
  _p: ActionResult<{ id: string } | undefined>,
  formData: FormData,
): Promise<ActionResult<{ id: string } | undefined>> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("TEACHER");
      const { id: testId } = await createClassTest(ctx, parseFormData(classTestSchema, formData));
      return successResult("Test created. Enter the marks once it is held.", { id: testId });
    },
    {
      revalidate: EXAM_PAGES,
      redirectTo: (data) => (data ? (`/teacher/exams/${data.id}` as Route) : null),
    },
  );
}

export async function reopenMarksAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await admin();
      const { assessmentId, reason } = parseFormData(reopenMarksSchema, formData);
      await reopenMarks(ctx, assessmentId, reason);
      return successResult("Marks reopened for correction. Families no longer see them until they are submitted again.");
    },
    { revalidate: EXAM_PAGES },
  );
}

export async function updateClassTestAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN", "PRINCIPAL", "TEACHER");
      const { syllabusItemId, ...input } = parseFormData(updateClassTestSchema, formData);
      // Only a form that shows the syllabus choice may change it; others leave the link as it is.
      await updateClassTest(ctx, formData.has("syllabusItemId") ? { ...input, syllabusItemId } : input);
      return successResult("Test updated.");
    },
    { revalidate: EXAM_PAGES },
  );
}

export async function deleteClassTestAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("TEACHER");
      const { assessmentId } = parseFormData(z.object({ assessmentId: id }), formData);
      await deleteClassTest(ctx, assessmentId);
      return successResult("Test deleted.");
    },
    { revalidate: EXAM_PAGES, redirectTo: "/teacher/exams" },
  );
}

export async function adminDeleteClassTestAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await admin();
      const { assessmentId } = parseFormData(z.object({ assessmentId: id }), formData);
      await deleteClassTest(ctx, assessmentId);
      return successResult("Test deleted.");
    },
    { revalidate: EXAM_PAGES, redirectTo: "/school-admin/exams" },
  );
}

const attentionSettingsSchema = z.object({
  percent: z.coerce.number().int("Enter a whole number").min(1, "At least 1%").max(99, "At most 99%"),
  repeat: z.coerce.number().int().min(1).max(3),
});

export async function saveAttentionSettingsAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await admin();
      await saveAttentionSettings(ctx, parseFormData(attentionSettingsSchema, formData));
      return successResult("Needs Attention rule saved.");
    },
    { revalidate: EXAM_PAGES },
  );
}

const signalSettingsSchema = z.object({
  percent: z.coerce.number().int().min(1, "At least 1%").max(99, "At most 99%"),
  days: z.coerce.number().int().min(7, "At least 7 days").max(120, "At most 120 days"),
});

/** The attendance part of Needs Attention (the School Admin's setting). */
export async function saveSignalSettingsAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await admin();
      await saveSignalSettings(ctx, parseFormData(signalSettingsSchema, formData));
      return successResult("Attendance rule saved.");
    },
    { revalidate: EXAM_PAGES },
  );
}

/** Review step: verify the submitted marks (School Admin or Principal). */
export async function verifyExamAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await admin();
      const { examId } = parseFormData(z.object({ examId: id }), formData);
      await verifyExam(ctx, examId);
      return successResult("Results verified. They can be published now.");
    },
    { revalidate: EXAM_PAGES },
  );
}

/** Correct one published mark, with the reason (kept on the audit log). */
export async function correctResultAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await admin();
      await correctPublishedResult(ctx, parseFormData(correctResultSchema, formData));
      return successResult("Mark corrected. Families see the corrected result now.");
    },
    { revalidate: [...EXAM_PAGES, "/parent", "/student", "/report-cards"] },
  );
}

/** Settings → Grading: the school's scale (one "grade: from %" per line) and pass percentage. */
export async function saveGradingRulesAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN");
      const input = parseFormData(gradingRulesSchema, formData);
      const bands = input.useDefault
        ? null
        : input.bands
            .split(/\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => {
              const match = line.match(/^(.+?)\s*[:=]\s*(\d+)\s*%?$/);
              if (!match) throw new ValidationError("Please correct the highlighted fields.", { bands: [`Write each line as "Grade: from %", e.g. "A1: 91" — not "${line}".`] });
              return { grade: match[1]!.trim(), min: Number(match[2]) };
            });
      await saveGradingRules(ctx, { bands, passPercent: input.passPercent });
      return successResult("Grading rules saved. Every result and report card uses them now.");
    },
    { revalidate: [...EXAM_PAGES, "/report-cards"] },
  );
}

/** The session's final result: which exams count, and how much. */
export async function saveResultSchemeAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await admin();
      const input = parseFormData(resultSchemeSchema, formData);
      await saveResultScheme(ctx, { name: input.name, components: parseComponents(input.components) });
      return successResult("Final result saved.");
    },
    { revalidate: EXAM_PAGES },
  );
}
