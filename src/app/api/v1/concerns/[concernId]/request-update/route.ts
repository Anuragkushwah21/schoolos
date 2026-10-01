import { concernUpdateRequestSchema } from "@/lib/validation/support";
import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { requestConcernUpdate } from "@/server/support/concerns";

/** School Admin: ask the teacher for an update. `{ note? }` */
export const POST = apiRoute<{ concernId: string }>({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx, params }) => {
  await requestConcernUpdate(ctx, await readJson(request, concernUpdateRequestSchema, { concernId: params.concernId }));
  return apiSuccess({ ok: true });
});
