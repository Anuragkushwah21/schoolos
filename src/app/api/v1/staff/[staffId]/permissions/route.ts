import { z } from "zod";

import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { getStaff, setStaffGrants } from "@/server/operations/staff";
import { substitutionsFor } from "@/server/staff/substitutions";

type Params = { staffId: string };

/** A staff member's own grants, and the temporary ones from substitutions active today. */
export const GET = apiRoute<Params>({ roles: ["SCHOOL_ADMIN"] }, async ({ ctx, params }) => {
  const [staff, substitutions] = await Promise.all([getStaff(ctx, params.staffId), substitutionsFor(ctx, params.staffId)]);
  return apiSuccess({
    grants: staff.grants,
    temporary: substitutions.covering.filter((row) => row.status === "ACTIVE").map((row) => ({ substitutionId: row.id, coveringFor: row.original.name, until: row.endDate, grants: row.grants })),
  });
});

/** Replace a staff member's grants: `{ "grants": ["library.view", …] }`. Grants their role can never hold are refused (422). */
export const PUT = apiRoute<Params>({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx, params }) => {
  const { grants } = await readJson(request, z.object({ grants: z.array(z.string().max(60)).max(100) }));
  return apiSuccess({ grants: await setStaffGrants(ctx, params.staffId, grants) });
});
