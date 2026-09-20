import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { academicSessionSchema } from "@/lib/validation/school";
import { createAcademicSession, listAcademicSessions } from "@/server/academics/structure";

export const GET = apiRoute(
  { roles: ["SCHOOL_ADMIN", "TEACHER"] },
  async ({ ctx }) => apiSuccess(await listAcademicSessions(ctx)),
);

/** Create a year. Overlapping dates are refused. */
export const POST = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx }) => {
  const input = await readJson(request, academicSessionSchema);
  await createAcademicSession(ctx, input);
  return apiSuccess(await listAcademicSessions(ctx), { status: 201 });
});
