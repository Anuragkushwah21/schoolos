import { z } from "zod";

import { apiRoute, apiSuccess, readQuery } from "@/server/api/handler";
import { dateQuery } from "@/lib/validation/api";
import { AUDIT_AREAS, type AuditArea, listSchoolAudit } from "@/server/audit/school";

const query = z.object({
  area: z.enum(Object.keys(AUDIT_AREAS) as [AuditArea, ...AuditArea[]]).optional(),
  q: z.string().trim().max(100).optional(),
  from: dateQuery.optional(),
  to: dateQuery.optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
});

/** This school's audit trail, newest first. School Admin only; never another school's. */
export const GET = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx }) => {
  const { rows, ...meta } = await listSchoolAudit(ctx, readQuery(request, query));
  return apiSuccess(rows, { meta });
});
