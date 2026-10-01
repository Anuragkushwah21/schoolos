import { concernReplySchema } from "@/lib/validation/support";
import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { getConcern, replyToConcern } from "@/server/support/concerns";

/** One concern, with its status history (families never see staff-only notes). */
export const GET = apiRoute<{ concernId: string }>({ roles: ["SCHOOL_ADMIN", "TEACHER", "PARENT"] }, async ({ ctx, params }) =>
  apiSuccess(await getConcern(ctx, params.concernId)),
);

/** Update: `{ status?: OPEN|IN_PROGRESS|RESOLVED, message? }` — the concern's teacher or the School Admin. */
export const POST = apiRoute<{ concernId: string }>({ roles: ["SCHOOL_ADMIN", "TEACHER"] }, async ({ request, ctx, params }) => {
  await replyToConcern(ctx, await readJson(request, concernReplySchema, { concernId: params.concernId }));
  return apiSuccess({ ok: true });
});
