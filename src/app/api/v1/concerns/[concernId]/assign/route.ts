import { concernAssignSchema } from "@/lib/validation/support";
import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { assignConcern } from "@/server/support/concerns";

/** School Admin: hand a concern to a current teacher. `{ teacherId }` */
export const POST = apiRoute<{ concernId: string }>({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx, params }) => {
  await assignConcern(ctx, await readJson(request, concernAssignSchema, { concernId: params.concernId }));
  return apiSuccess({ ok: true });
});
