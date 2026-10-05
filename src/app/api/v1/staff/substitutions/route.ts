import { z } from "zod";

import { apiRoute, apiSuccess, readJson, readQuery } from "@/server/api/handler";
import { substitutionSchema } from "@/lib/validation/staff-roles";
import { listSubstitutions, saveSubstitution, substitutionsFor } from "@/server/staff/substitutions";

const query = z.object({ staffId: z.string().max(64).optional(), status: z.enum(["SCHEDULED", "ACTIVE", "EXPIRED", "ENDED"]).optional() });

/** Substitution history: all (optionally by status), or one staff member's (`?staffId=`), with each one's status worked out from today. */
export const GET = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx }) => {
  const { staffId, status } = readQuery(request, query);
  return apiSuccess(staffId ? await substitutionsFor(ctx, staffId) : await listSubstitutions(ctx, { status }));
});

/** Assign a substitute: `{ originalStaffId, substituteStaffId, startDate, endDate, reason, notes, grants, coverRoutes }`. */
export const POST = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx }) => {
  const { id } = await saveSubstitution(ctx, await readJson(request, substitutionSchema, { substitutionId: undefined }));
  return apiSuccess({ id }, { status: 201 });
});
