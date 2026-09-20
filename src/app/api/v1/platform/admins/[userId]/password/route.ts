import { apiSuccess, platformRoute } from "@/server/api/handler";
import { resetSchoolAdminPassword } from "@/server/platform/schools";

/** Issue a new one-time password and sign that admin out everywhere. */
export const POST = platformRoute<{ userId: string }>(
  { roles: ["SUPER_ADMIN"] },
  async ({ actor, params }) => apiSuccess(await resetSchoolAdminPassword(actor.user, params.userId)),
);
