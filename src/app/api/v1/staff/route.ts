import { z } from "zod";

import { apiRoute, apiSuccess, readJson, readQuery } from "@/server/api/handler";
import { STAFF_ROLES, STAFF_STATUSES, staffSchema } from "@/lib/validation/operations";
import { listStaff, saveStaff } from "@/server/operations/staff";

const query = z.object({ q: z.string().trim().max(100).optional(), role: z.enum(STAFF_ROLES).optional(), status: z.enum(STAFF_STATUSES).optional() });

/** Non-teaching staff. School Admin only. */
export const GET = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx }) => apiSuccess(await listStaff(ctx, readQuery(request, query))));

export const POST = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx }) => {
  const id = await saveStaff(ctx, await readJson(request, staffSchema, { staffId: undefined }));
  return apiSuccess({ id }, { status: 201 });
});
