import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { supportFollowUpSchema } from "@/lib/validation/support";
import { followUpSupport, getSupport } from "@/server/support/service";

type Params = { supportId: string };

/** Add a follow-up: `{ note?, status?, priority?, action? }`. */
export const POST = apiRoute<Params>({ roles: ["SCHOOL_ADMIN", "TEACHER"] }, async ({ request, ctx, params }) => {
  await followUpSupport(ctx, await readJson(request, supportFollowUpSchema, { supportId: params.supportId }));
  return apiSuccess(await getSupport(ctx, params.supportId), { status: 201 });
});
