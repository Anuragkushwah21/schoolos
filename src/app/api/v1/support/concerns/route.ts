import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { concernReviewSchema } from "@/lib/validation/support";
import { listConcerns, reviewConcern } from "@/server/support/service";

/** Parent concerns awaiting review: the teacher's own, or all for the admin. */
export const GET = apiRoute({ roles: ["SCHOOL_ADMIN", "TEACHER"] }, async ({ ctx }) => apiSuccess(await listConcerns(ctx)));

/** Review one: `{ concernId, status: REVIEWING|ACTION_TAKEN|RESOLVED, response? }`. */
export const PATCH = apiRoute({ roles: ["SCHOOL_ADMIN", "TEACHER"] }, async ({ request, ctx }) => {
  await reviewConcern(ctx, await readJson(request, concernReviewSchema));
  return apiSuccess({ ok: true });
});
