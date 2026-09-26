import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { updateTeacherSchema } from "@/lib/validation/school";
import { deleteTeacher, getTeacherProfile, updateTeacher } from "@/server/people/teachers";

type Params = { teacherId: string };

export const GET = apiRoute<Params>({ roles: ["SCHOOL_ADMIN"] }, async ({ ctx, params }) => {
  const { teacher, session, periodsPerWeek } = await getTeacherProfile(ctx, params.teacherId);
  return apiSuccess({ teacher, session, periodsPerWeek });
});

/** Status INACTIVE also disables the teacher's login, in the same call. */
export const PUT = apiRoute<Params>({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx, params }) => {
  const input = await readJson(request, updateTeacherSchema, { teacherId: params.teacherId });
  await updateTeacher(ctx, input);
  const { teacher } = await getTeacherProfile(ctx, params.teacherId);
  return apiSuccess(teacher);
});

/**
 * Erase a teacher and their login.
 *
 * Answers 409 once they have a record in the school — a register, a lesson, a
 * piece of homework, a remark — because none of that can be undone. Use
 * `PUT` with `status: "INACTIVE"` for someone who has left: it keeps the
 * history and closes the sign-in.
 */
export const DELETE = apiRoute<Params>({ roles: ["SCHOOL_ADMIN"] }, async ({ ctx, params }) => {
  await deleteTeacher(ctx, params.teacherId);
  return apiSuccess({ deleted: true });
});
