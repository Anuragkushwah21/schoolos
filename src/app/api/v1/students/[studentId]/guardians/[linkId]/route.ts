import { apiRoute, apiSuccess } from "@/server/api/handler";
import { unlinkGuardian } from "@/server/people/students";

/** Unlink a guardian. Their own record is kept. */
export const DELETE = apiRoute<{ studentId: string; linkId: string }>(
  { roles: ["SCHOOL_ADMIN"] },
  async ({ ctx, params }) => {
    await unlinkGuardian(ctx, params.linkId);
    return apiSuccess({ unlinked: true });
  },
);
