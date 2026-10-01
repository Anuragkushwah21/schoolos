import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { parentConcernSchema } from "@/lib/validation/support";
import { raiseParentConcern } from "@/server/support/concerns";
import { familySupport, mySupport } from "@/server/support/service";

/** A student's extra help, or a parent's children's support. Concerns: `/api/v1/concerns`. */
export const GET = apiRoute({ roles: ["STUDENT", "PARENT"] }, async ({ ctx }) =>
  apiSuccess(ctx.user.role === "STUDENT" ? await mySupport(ctx) : await familySupport(ctx)),
);

/** Kept for older clients: same as `POST /api/v1/concerns` for a parent. */
export const POST = apiRoute({ roles: ["PARENT"] }, async ({ request, ctx }) => {
  const concern = await raiseParentConcern(ctx, await readJson(request, parentConcernSchema));
  return apiSuccess(concern, { status: 201 });
});
