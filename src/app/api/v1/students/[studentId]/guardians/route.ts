import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { linkGuardianSchema } from "@/lib/validation/school";
import { getStudentProfile, linkGuardian } from "@/server/people/students";

/** Link a guardian — an existing record, or a new one created here. */
export const POST = apiRoute<{ studentId: string }>(
  { roles: ["SCHOOL_ADMIN"] },
  async ({ request, ctx, params }) => {
    const input = await readJson(request, linkGuardianSchema, { studentId: params.studentId });
    await linkGuardian(ctx, input);
    const { student } = await getStudentProfile(ctx, params.studentId);
    return apiSuccess(student.parents, { status: 201 });
  },
);
