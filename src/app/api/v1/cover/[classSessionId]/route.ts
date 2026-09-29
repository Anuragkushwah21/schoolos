import { apiRoute, apiSuccess } from "@/server/api/handler";
import { clearSubstitute } from "@/server/classwork/substitutes";

type Params = { classSessionId: string };

/** Hand a covered period back to its own teacher. */
export const DELETE = apiRoute<Params>({ roles: ["SCHOOL_ADMIN"] }, async ({ ctx, params }) => {
  await clearSubstitute(ctx, params.classSessionId);
  return apiSuccess({ cleared: true });
});
