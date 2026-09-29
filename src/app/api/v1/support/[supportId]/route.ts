import { apiRoute, apiSuccess } from "@/server/api/handler";
import { getSupport } from "@/server/support/service";

type Params = { supportId: string };

/** One support record with its follow-ups, for staff who may see it. */
export const GET = apiRoute<Params>({ roles: ["SCHOOL_ADMIN", "TEACHER"] }, async ({ ctx, params }) => apiSuccess(await getSupport(ctx, params.supportId)));
