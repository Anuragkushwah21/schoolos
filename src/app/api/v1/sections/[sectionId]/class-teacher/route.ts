import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { classTeacherSchema } from "@/lib/validation/school";
import { getSection, setClassTeacher } from "@/server/academics/structure";

type Params = { sectionId: string };

/**
 * Set a section's class teacher: `{ "teacherId": "…" }` to assign or change,
 * `{ "teacherId": null }` to remove. The section comes from the path and the
 * school from the caller; a `schoolId` in the body is ignored.
 */
export const PUT = apiRoute<Params>({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx, params }) => {
  const input = await readJson(request, classTeacherSchema, { sectionId: params.sectionId });
  await setClassTeacher(ctx, input);
  return apiSuccess(await getSection(ctx, params.sectionId));
});

/** Remove the class teacher. The section's subject teachers are untouched. */
export const DELETE = apiRoute<Params>({ roles: ["SCHOOL_ADMIN"] }, async ({ ctx, params }) => {
  await setClassTeacher(ctx, { sectionId: params.sectionId, teacherId: null });
  return apiSuccess(await getSection(ctx, params.sectionId));
});
