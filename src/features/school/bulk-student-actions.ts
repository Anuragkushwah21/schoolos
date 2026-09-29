"use server";

import { z } from "zod";

import { type ActionResult, parseFormData, successResult } from "@/lib/action-result";
import { bulkStatusSchema, changeSectionSchema, promoteSchema } from "@/lib/validation/bulk-students";
import { requireTenantForAction } from "@/server/auth/current-user";
import { changeSection, type ImportError, importStudents, promoteStudents, setStudentsStatus } from "@/server/people/bulk-students";
import { performAction } from "@/server/perform-action";

type Result = ActionResult<undefined>;
const PAGES = ["/school-admin", "/teacher", "/student", "/parent"];

/** One form, three operations: the clicked button's `operation` decides which. */
export async function bulkStudentsAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN");
      const { operation } = parseFormData(z.object({ operation: z.enum(["promote", "move", "status"]) }), formData);
      if (operation === "promote") {
        const input = parseFormData(promoteSchema, formData);
        const { promoted } = await promoteStudents(ctx, {
          fromSessionId: input.fromSessionId,
          toSectionId: input.promoteToSectionId,
          studentIds: input.studentIds,
        });
        return successResult(`${promoted} student${promoted === 1 ? "" : "s"} promoted.`);
      }
      if (operation === "move") {
        const input = parseFormData(changeSectionSchema, formData);
        const { moved } = await changeSection(ctx, { toSectionId: input.moveToSectionId, studentIds: input.studentIds });
        return successResult(`${moved} student${moved === 1 ? "" : "s"} moved.`);
      }
      const { updated } = await setStudentsStatus(ctx, parseFormData(bulkStatusSchema, formData));
      return successResult(`${updated} student${updated === 1 ? "" : "s"} updated.`);
    },
    { revalidate: PAGES },
  );
}

export type StudentImportResult = ActionResult<{ created: number } | undefined>;

export async function importStudentsAction(_p: StudentImportResult, formData: FormData): Promise<StudentImportResult> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN");
      const file = formData.get("file");
      if (!(file instanceof File) || file.size === 0) return { status: "error", message: "Choose the CSV file to import." };
      if (file.size > 2_000_000) return { status: "error", message: "The file is too large. Import at most 500 students at a time." };
      const result = await importStudents(ctx, await file.text());
      if (result.errors.length) return importErrors(result.errors);
      return successResult(`${result.created} student${result.created === 1 ? "" : "s"} admitted.`, { created: result.created });
    },
    { revalidate: PAGES },
  );
}

function importErrors(errors: ImportError[]): StudentImportResult {
  return {
    status: "error",
    message: `Nothing was imported. Fix ${errors.length} row${errors.length === 1 ? "" : "s"} and try again.`,
    fieldErrors: Object.fromEntries(errors.map((error, index) => [`line ${error.line}#${index}`, [error.message]])),
  };
}
