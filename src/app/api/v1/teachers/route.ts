import { apiRoute, apiSuccess, readJson, readQuery } from "@/server/api/handler";
import { teachersQuery } from "@/lib/validation/api";
import { createTeacherSchema } from "@/lib/validation/school";
import { createTeacher, listTeachers } from "@/server/people/teachers";

export const GET = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx }) => {
  const query = readQuery(request, teachersQuery);
  const { rows, total, page, pageCount } = await listTeachers(ctx, query);
  return apiSuccess(rows, { meta: { page, pageCount, total } });
});

/**
 * Add a teacher. The staff record and their login are created together, and
 * the one-time password is returned here only.
 */
export const POST = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx }) => {
  const input = await readJson(request, createTeacherSchema);
  const { teacherId, credentials } = await createTeacher(ctx, input);
  return apiSuccess({ teacherId, credentials }, { status: 201 });
});
