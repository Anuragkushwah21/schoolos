import { apiRoute, apiSuccess, readJson, readQuery } from "@/server/api/handler";
import { studentsQuery } from "@/lib/validation/api";
import { createStudentSchema } from "@/lib/validation/school";
import { createStudent, getStudentProfile, listStudents } from "@/server/people/students";

/** Students of the caller's school, with the current session's placement. */
export const GET = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx }) => {
  const query = readQuery(request, studentsQuery);
  const { rows, total, page, pageCount } = await listStudents(ctx, {
    q: query.q,
    sectionId: query.section,
    classId: query.class,
    status: query.status,
    gender: query.gender,
    page: query.page,
  });
  return apiSuccess(rows, { meta: { page, pageCount, total } });
});

/** Admit a student: the person, their placement and optionally a guardian. */
export const POST = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx }) => {
  const input = await readJson(request, createStudentSchema);
  const result = await createStudent(ctx, input);
  const { student } = await getStudentProfile(ctx, result.studentId);
  return apiSuccess(student, { status: 201, meta: { activationEmails: result.invites, notes: result.notes } });
});
