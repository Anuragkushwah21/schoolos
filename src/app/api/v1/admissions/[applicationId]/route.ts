import { apiRoute, apiSuccess } from "@/server/api/handler";
import { getApplication } from "@/server/admissions/service";

export const GET = apiRoute<{ applicationId: string }>(
  { roles: ["SCHOOL_ADMIN"] },
  async ({ ctx, params }) => apiSuccess(await getApplication(ctx, params.applicationId)),
);
