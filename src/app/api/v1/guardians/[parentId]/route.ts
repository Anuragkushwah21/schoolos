import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { updateParentSchema } from "@/lib/validation/school";
import { updateParent } from "@/server/people/students";

/** Replace a guardian's contact details. */
export const PUT = apiRoute<{ parentId: string }>(
  { roles: ["SCHOOL_ADMIN"] },
  async ({ request, ctx, params }) => {
    const input = await readJson(request, updateParentSchema, { parentId: params.parentId });
    await updateParent(ctx, input);
    return apiSuccess({ id: params.parentId, ...input });
  },
);
