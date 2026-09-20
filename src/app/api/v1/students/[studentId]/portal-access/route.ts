import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { portalAccessSchema } from "@/lib/validation/school";
import { grantStudentPortal } from "@/server/people/students";

/**
 * Issue the student's login. The password is returned once, here, and is
 * stored only as a bcrypt hash.
 */
export const POST = apiRoute<{ studentId: string }>(
  { roles: ["SCHOOL_ADMIN"] },
  async ({ request, ctx, params }) => {
    const { email } = await readJson(request, portalAccessSchema, { personId: params.studentId });
    const credentials = await grantStudentPortal(ctx, params.studentId, email);
    return apiSuccess(credentials, { status: 201 });
  },
);
