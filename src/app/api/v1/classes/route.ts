import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { classSchema } from "@/lib/validation/school";
import { createClass, listClasses } from "@/server/academics/structure";

export const GET = apiRoute(
  { roles: ["SCHOOL_ADMIN", "TEACHER"] },
  async ({ ctx }) => apiSuccess(await listClasses(ctx)),
);

export const POST = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx }) => {
  await createClass(ctx, await readJson(request, classSchema));
  return apiSuccess(await listClasses(ctx), { status: 201 });
});
