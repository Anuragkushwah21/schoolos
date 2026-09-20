import { apiRoute, apiSuccess } from "@/server/api/handler";
import { unassignSubject } from "@/server/people/teachers";

/** Remove an assignment; the teacher loses access unless they are class teacher. */
export const DELETE = apiRoute<{ teacherId: string; assignmentId: string }>(
  { roles: ["SCHOOL_ADMIN"] },
  async ({ ctx, params }) => {
    await unassignSubject(ctx, params.assignmentId);
    return apiSuccess({ removed: true });
  },
);
