"use server";

import type { Route } from "next";
import { z } from "zod";

import { type ActionResult, errorResult, parseFormData, successResult } from "@/lib/action-result";
import { ValidationError } from "@/lib/errors";
import { id } from "@/lib/validation/common";
import { classTestSchema, createExamSchema, examIdsSchema, type MarkEntry, updateExamSchema } from "@/lib/validation/exams";
import { requireTenantForAction } from "@/server/auth/current-user";
import {
  createClassTest,
  createExams,
  deleteExam,
  type ImportError,
  importMarksCsv,
  publishExams,
  saveMarks,
  unpublishExam,
  updateExam,
} from "@/server/exams/service";
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
    { revalidate: EXAM_PAGES, redirectTo: "/school-admin/exams" },
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
    { revalidate: EXAM_PAGES, redirectTo: "/school-admin/exams" },
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
      const { saved, cleared } = await saveMarks(ctx, assessmentId, readMarks(formData));
      return successResult(`Marks saved for ${saved} student${saved === 1 ? "" : "s"}${cleared ? `, ${cleared} cleared` : ""}.`);
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
      return successResult("Test created. Enter the marks below.", { id: testId });
    },
    {
      revalidate: EXAM_PAGES,
      redirectTo: (data) => (data ? (`/teacher/exams/${data.id}` as Route) : null),
    },
  );
}
