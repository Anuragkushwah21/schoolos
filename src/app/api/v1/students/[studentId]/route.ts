import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { updateStudentSchema } from "@/lib/validation/school";
import { deleteStudent, getStudentProfile, updateStudent } from "@/server/people/students";

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

/**
 * Erase a student admitted by mistake.
 *
 * Answers 409 once the child has a register, a remark or a result behind them,
 * because none of that can be undone. For a child who has left, `PUT` with
 * `status: "TRANSFERRED"` or `"GRADUATED"` keeps the record and closes the
 * sign-in.
 */
export const DELETE = apiRoute<Params>({ roles: ["SCHOOL_ADMIN"] }, async ({ ctx, params }) => {
  await deleteStudent(ctx, params.studentId);
  return apiSuccess({ deleted: true });
});
