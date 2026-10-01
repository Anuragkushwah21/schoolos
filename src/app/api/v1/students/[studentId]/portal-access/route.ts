import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { portalAccessSchema } from "@/lib/validation/school";
import { grantStudentPortal } from "@/server/people/students";

/** Create the student's login; they activate it from the email it sends. No password is returned. */
export const POST = apiRoute<{ studentId: string }>(
  { roles: ["SCHOOL_ADMIN"] },
  async ({ request, ctx, params }) => {
    const { email } = await readJson(request, portalAccessSchema, { personId: params.studentId });
    const invite = await grantStudentPortal(ctx, params.studentId, email);
    return apiSuccess(invite, { status: 201 });
  },
);
