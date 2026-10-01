import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { concernReplySchema } from "@/lib/validation/support";
import { listConcerns, replyToConcern } from "@/server/support/concerns";

/** Kept for older clients. Open concerns: the teacher's own, or all for the admin. See `/api/v1/concerns`. */
export const GET = apiRoute({ roles: ["SCHOOL_ADMIN", "TEACHER"] }, async ({ ctx }) => apiSuccess(await listConcerns(ctx)));

/** Reply and/or change status: `{ concernId, message?, status?, priority? }`. */
export const PATCH = apiRoute({ roles: ["SCHOOL_ADMIN", "TEACHER"] }, async ({ request, ctx }) => {
  await replyToConcern(ctx, await readJson(request, concernReplySchema));
  return apiSuccess({ ok: true });
});
