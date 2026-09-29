import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { marksBodySchema } from "@/lib/validation/exams";
import { getMarksSheet, saveMarks } from "@/server/exams/service";

type Params = { assessmentId: string };

/** A paper's marks sheet. School Admin, or the teacher of that subject in that section. */
export const GET = apiRoute<Params>({ roles: ["SCHOOL_ADMIN", "TEACHER"] }, async ({ ctx, params }) =>
  apiSuccess(await getMarksSheet(ctx, params.assessmentId)),
);

/**
 * Save marks: `{ entries: [{ studentId, marks, absent?, remark? }] }`. Every
 * row is validated first; one bad row refuses the save. Locked once published.
 */
export const PUT = apiRoute<Params>({ roles: ["SCHOOL_ADMIN", "TEACHER"] }, async ({ request, ctx, params }) => {
  const { entries } = await readJson(request, marksBodySchema);
  const result = await saveMarks(
    ctx,
    params.assessmentId,
    entries.map((entry) => ({
      studentId: entry.studentId,
      marks: entry.absent ? null : (entry.marks ?? null),
      absent: entry.absent ?? false,
      remark: entry.remark,
    })),
  );
  return apiSuccess(await getMarksSheet(ctx, params.assessmentId), { meta: result });
});
