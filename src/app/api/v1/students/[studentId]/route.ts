import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { updateStudentSchema } from "@/lib/validation/school";
import { getStudentProfile, updateStudent } from "@/server/people/students";

type Params = { studentId: string };

/** One student: profile, every year's placement, guardians and attendance totals. */
export const GET = apiRoute<Params>({ roles: ["SCHOOL_ADMIN"] }, async ({ ctx, params }) => {
  const { student, attendance } = await getStudentProfile(ctx, params.studentId);
  return apiSuccess({ student, attendance });
});

/** Replace the student's own details. Placement moves through /enrollments. */
export const PUT = apiRoute<Params>({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx, params }) => {
  const input = await readJson(request, updateStudentSchema, { studentId: params.studentId });
  await updateStudent(ctx, input);
  const { student } = await getStudentProfile(ctx, params.studentId);
  return apiSuccess(student);
});
