import { z } from "zod";

import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { id } from "@/lib/validation/common";
import { STUDENT_STATUSES } from "@/lib/validation/school";
import { setStudentsStatus } from "@/server/people/bulk-students";

/** Set status for many students: `{ status, studentIds }`. Leaving students lose their login. */
export const POST = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx }) => {
  const input = await readJson(request, z.object({ status: z.enum(STUDENT_STATUSES), studentIds: z.array(id).min(1).max(1000) }));
  return apiSuccess(await setStudentsStatus(ctx, input));
});
