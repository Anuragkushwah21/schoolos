import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { assignmentSchema } from "@/lib/validation/school";
import { assignSubject, getTeacherProfile } from "@/server/people/teachers";

/**
 * Assign a subject in a section for the current session. This is also the
 * grant that lets the teacher mark that section's attendance.
 */
export const POST = apiRoute<{ teacherId: string }>(
  { roles: ["SCHOOL_ADMIN"] },
  async ({ request, ctx, params }) => {
    const input = await readJson(request, assignmentSchema, { teacherId: params.teacherId });
    await assignSubject(ctx, input);
    const { teacher } = await getTeacherProfile(ctx, params.teacherId);
    return apiSuccess(teacher.assignments, { status: 201 });
  },
);
