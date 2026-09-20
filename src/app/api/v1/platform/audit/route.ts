import { apiSuccess, platformRoute, readQuery } from "@/server/api/handler";
import { auditQuery } from "@/lib/validation/api";
import { listAuditLog } from "@/server/platform/audit";

/** The platform-wide audit trail, newest first. */
export const GET = platformRoute({ roles: ["SUPER_ADMIN"] }, async ({ request, actor }) => {
  const query = readQuery(request, auditQuery);
  const { rows, total, page, pageCount } = await listAuditLog(actor.user, query);
  return apiSuccess(rows, { meta: { page, pageCount, total } });
});
