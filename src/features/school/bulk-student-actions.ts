"use server";

import { z } from "zod";

import { type ActionResult, parseFormData, successResult } from "@/lib/action-result";
import { bulkStatusSchema, changeSectionSchema, promoteSchema } from "@/lib/validation/bulk-students";
import { requireTenantForAction } from "@/server/auth/current-user";
import { changeSection, importStudents, promoteStudents, setStudentsStatus, type StudentImportReport } from "@/server/people/bulk-students";
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

export type StudentImportResult = ActionResult<(StudentImportReport & { mode: "check" | "import" }) | undefined>;

/**
 * "Check file" (`mode=check`) previews without writing; "Import valid
 * records" (`mode=import`, `validOnly=1`) writes the rows that passed.
 */
export async function importStudentsAction(_p: StudentImportResult, formData: FormData): Promise<StudentImportResult> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN");
      if (formData.get("mode") === "cancel") return { status: "idle" };
      const file = formData.get("file");
      if (!(file instanceof File) || file.size === 0) return { status: "error", message: "Choose the CSV file to import." };
      if (file.size > 2_000_000) return { status: "error", message: "The file is too large. Import at most 500 students at a time." };
      const mode = formData.get("mode") === "import" ? "import" : "check";
      const report = await importStudents(ctx, await file.text(), { mode, validOnly: formData.get("validOnly") === "1" });
      if (mode === "import" && report.created) {
        const skipped = report.total - report.created;
        return successResult(
          `${report.created} student${report.created === 1 ? "" : "s"} admitted.${skipped ? ` ${skipped} row${skipped === 1 ? " was" : "s were"} left out — fix and import them separately.` : ""}`,
          { ...report, mode },
        );
      }
      return successResult(undefined, { ...report, mode });
    },
    { revalidate: PAGES },
  );
}
