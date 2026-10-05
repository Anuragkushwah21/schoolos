import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { roleProfileSchema } from "@/lib/validation/staff-roles";
import { getRoleProfile, saveRoleProfile } from "@/server/staff/roles";

type Params = { roleId: string };

/** One role with its staff and default grants. */
export const GET = apiRoute<Params>({ roles: ["SCHOOL_ADMIN"] }, async ({ ctx, params }) => apiSuccess(await getRoleProfile(ctx, params.roleId)));

/** Change a role's description and default grants; `applyToStaff: true` gives everyone in it exactly those grants. */
export const PUT = apiRoute<Params>({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx, params }) => {
  const result = await saveRoleProfile(ctx, await readJson(request, roleProfileSchema, { roleId: params.roleId }));
  return apiSuccess(result);
});
