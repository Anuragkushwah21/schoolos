import { apiSuccess, platformRoute } from "@/server/api/handler";
import { getSchoolForPlatform } from "@/server/platform/schools";

export const GET = platformRoute<{ schoolId: string }>(
  { roles: ["SUPER_ADMIN"] },
  async ({ actor, params }) => apiSuccess(await getSchoolForPlatform(actor.user, params.schoolId)),
);
