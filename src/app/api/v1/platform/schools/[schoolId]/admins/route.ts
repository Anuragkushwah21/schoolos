import { apiSuccess, platformRoute, readJson } from "@/server/api/handler";
import { createSchoolAdminSchema } from "@/lib/validation/platform";
import { createSchoolAdmin, getSchoolForPlatform } from "@/server/platform/schools";

export const GET = platformRoute<{ schoolId: string }>(
  { roles: ["SUPER_ADMIN"] },
  async ({ actor, params }) => {
    const { admins } = await getSchoolForPlatform(actor.user, params.schoolId);
    return apiSuccess(admins);
  },
);

/** Create a School Admin. The password is returned once, here. */
export const POST = platformRoute<{ schoolId: string }>(
  { roles: ["SUPER_ADMIN"] },
  async ({ request, actor, params }) => {
    const input = await readJson(request, createSchoolAdminSchema, { schoolId: params.schoolId });
    return apiSuccess(await createSchoolAdmin(actor.user, input), { status: 201 });
  },
);
