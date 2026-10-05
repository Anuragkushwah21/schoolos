import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { substitutionSchema } from "@/lib/validation/staff-roles";
import { saveSubstitution } from "@/server/staff/substitutions";

type Params = { substitutionId: string };

/** Change a substitution that has not finished (dates, reason, grants). A finished one answers 409. */
export const PUT = apiRoute<Params>({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx, params }) => {
  return apiSuccess(await saveSubstitution(ctx, await readJson(request, substitutionSchema, { substitutionId: params.substitutionId })));
});
