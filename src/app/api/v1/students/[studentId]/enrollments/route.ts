import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { enrollmentSchema } from "@/lib/validation/school";
import { enrollStudent, getStudentProfile } from "@/server/people/students";

/**
 * Place the student in a section for a session. The same session moves them;
 * a later session promotes them, leaving this year's record as history.
 */
export const POST = apiRoute<{ studentId: string }>(
  { roles: ["SCHOOL_ADMIN"] },
  async ({ request, ctx, params }) => {
    const input = await readJson(request, enrollmentSchema, { studentId: params.studentId });
    await enrollStudent(ctx, input);
    const { student } = await getStudentProfile(ctx, params.studentId);
    return apiSuccess(student.enrollments, { status: 201 });
  },
);
