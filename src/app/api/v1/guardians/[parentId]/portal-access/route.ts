import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { portalAccessSchema } from "@/lib/validation/school";
import { grantParentPortal } from "@/server/people/students";

/** Issue a guardian's login. They will see every child linked to them. */
export const POST = apiRoute<{ parentId: string }>(
  { roles: ["SCHOOL_ADMIN"] },
  async ({ request, ctx, params }) => {
    const { email } = await readJson(request, portalAccessSchema, { personId: params.parentId });
    const invite = await grantParentPortal(ctx, params.parentId, email);
    return apiSuccess(invite, { status: 201 });
  },
);
