import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { roleProfileSchema } from "@/lib/validation/staff-roles";
import { listRoleProfiles, saveRoleProfile } from "@/server/staff/roles";

/** Every non-teaching role at the school (built-in and custom) with its default grants and staff count. */
export const GET = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ ctx }) => apiSuccess(await listRoleProfiles(ctx)));

/** Add a custom role: `{ name, baseRole, description, defaultGrants }`. */
export const POST = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx }) => {
  const { id } = await saveRoleProfile(ctx, await readJson(request, roleProfileSchema, { roleId: undefined }));
  return apiSuccess({ id }, { status: 201 });
});
