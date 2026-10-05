"use server";

import type { Route } from "next";
import { z } from "zod";

import { type ActionResult, errorResult, parseFormData, successResult } from "@/lib/action-result";
import { ValidationError } from "@/lib/errors";
import { id } from "@/lib/validation/common";
import { classTestSchema, createExamSchema, examIdsSchema, type MarkEntry, reopenMarksSchema, updateClassTestSchema, updateExamSchema } from "@/lib/validation/exams";
import { requireTenantForAction } from "@/server/auth/current-user";
import {
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
} from "@/server/exams/service";
import { saveAttentionSettings } from "@/server/exams/attention";
import { performAction } from "@/server/perform-action";

type Result = ActionResult<undefined>;

/** Results reach every portal, so all four areas are refreshed. */
const EXAM_PAGES = ["/school-admin", "/teacher", "/student", "/parent"];

const admin = () => requireTenantForAction("SCHOOL_ADMIN");

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
      const { examId } = parseFormData(z.object({ examId: id }), formData);
      await unpublishExam(ctx, examId);
      return successResult("Results withdrawn. Marks can be corrected now.");
    },
    { revalidate: EXAM_PAGES },
  );
}

/** Marks arrive as `marks:<id>`, `absent:<id>` and `remark:<id>` per student row. */
function readMarks(formData: FormData): MarkEntry[] {
  const entries: MarkEntry[] = [];
  const errors: Record<string, string[]> = {};
  for (const key of formData.keys()) {
    if (!key.startsWith("row:")) continue;
    const studentId = key.slice("row:".length);
    const raw = String(formData.get(`marks:${studentId}`) ?? "").trim();
    const absent = formData.get(`absent:${studentId}`) === "on";
    const remark = String(formData.get(`remark:${studentId}`) ?? "").trim().slice(0, 300) || null;
    if (raw !== "" && !/^\d+$/.test(raw)) {
      errors[`marks:${studentId}`] = ["Enter a whole number"];
      continue;
    }
    entries.push({ studentId, marks: raw === "" ? null : Number(raw), absent, remark });
  }
  if (Object.keys(errors).length) throw new ValidationError("Some marks need correcting.", errors);
  return entries;
}

export async function saveMarksAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN", "TEACHER");
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
      const ctx = await requireTenantForAction("SCHOOL_ADMIN", "TEACHER");
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
      const ctx = await requireTenantForAction("SCHOOL_ADMIN", "TEACHER");
      await updateClassTest(ctx, parseFormData(updateClassTestSchema, formData));
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
