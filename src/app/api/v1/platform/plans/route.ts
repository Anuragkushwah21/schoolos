import { apiSuccess, platformRoute } from "@/server/api/handler";
import { listPlans } from "@/server/platform/plans";

export const GET = platformRoute({ roles: ["SUPER_ADMIN"] }, async ({ actor }) =>
  apiSuccess(await listPlans(actor.user)),
);
