import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { staffSchema } from "@/lib/validation/operations";
import { getStaff, saveStaff } from "@/server/operations/staff";

type Params = { staffId: string };

/** One staff member, with their role and grants. School Admin only. */
export const GET = apiRoute<Params>({ roles: ["SCHOOL_ADMIN"] }, async ({ ctx, params }) => apiSuccess(await getStaff(ctx, params.staffId)));

/**
 * Update a staff member. Sending `status` (e.g. "INACTIVE", "RESIGNED")
 * deactivates or archives them through the usual status change — recorded,
 * with their login closed — never a delete; their history stays.
 */
export const PUT = apiRoute<Params>({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx, params }) => {
  await saveStaff(ctx, await readJson(request, staffSchema, { staffId: params.staffId }));
  return apiSuccess(await getStaff(ctx, params.staffId));
});
