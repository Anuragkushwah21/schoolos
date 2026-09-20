import { apiRoute, apiSuccess, readQuery } from "@/server/api/handler";
import { admissionsQuery } from "@/lib/validation/api";
import { listApplications } from "@/server/admissions/service";

export const GET = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx }) => {
  const { status } = readQuery(request, admissionsQuery);
  return apiSuccess(await listApplications(ctx, status));
});
