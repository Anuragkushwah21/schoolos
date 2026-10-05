import { apiRoute, apiSuccess } from "@/server/api/handler";
import { endSubstitution } from "@/server/staff/substitutions";

type Params = { substitutionId: string };

/** End a substitution now: the temporary access stops at once; the record is kept. */
export const POST = apiRoute<Params>({ roles: ["SCHOOL_ADMIN"] }, async ({ ctx, params }) => {
  await endSubstitution(ctx, params.substitutionId);
  return apiSuccess({ ended: true });
});
