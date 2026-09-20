import { apiSuccess, platformRoute, readQuery } from "@/server/api/handler";
import { schoolsQuery } from "@/lib/validation/api";
import { listSchools } from "@/server/platform/schools";

/**
 * Every school on the platform. Governance data only — status, contacts and
 * counts. A school's students and staff are not reachable from here.
 */
export const GET = platformRoute({ roles: ["SUPER_ADMIN"] }, async ({ request, actor }) => {
  const query = readQuery(request, schoolsQuery);
  const { rows, total, page, pageCount } = await listSchools(actor.user, query);
  return apiSuccess(rows, { meta: { page, pageCount, total } });
});
