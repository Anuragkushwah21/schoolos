import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { subjectSchema } from "@/lib/validation/school";
import { createSubject, listSubjects } from "@/server/academics/structure";

export const GET = apiRoute(
  { roles: ["SCHOOL_ADMIN", "TEACHER"] },
  async ({ ctx }) => apiSuccess(await listSubjects(ctx)),
);

export const POST = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx }) => {
  await createSubject(ctx, await readJson(request, subjectSchema));
  return apiSuccess(await listSubjects(ctx), { status: 201 });
});
