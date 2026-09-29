import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { concernSchema } from "@/lib/validation/support";
import { familySupport, mySupport, raiseConcern } from "@/server/support/service";

/** A student's extra help, or a parent's children's support and their concerns. */
export const GET = apiRoute({ roles: ["STUDENT", "PARENT"] }, async ({ ctx }) =>
  apiSuccess(ctx.user.role === "STUDENT" ? await mySupport(ctx) : await familySupport(ctx)),
);

/** A parent raises a concern: `{ studentId, subjectId?, reason, message? }`. */
export const POST = apiRoute({ roles: ["PARENT"] }, async ({ request, ctx }) => {
  const id = await raiseConcern(ctx, await readJson(request, concernSchema));
  return apiSuccess({ id }, { status: 201 });
});
