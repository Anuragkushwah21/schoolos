import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { activeBody } from "@/lib/validation/api";
import { setSubjectActive } from "@/server/academics/structure";

/** A disabled subject stays on past records but cannot be newly assigned. */
export const PATCH = apiRoute<{ subjectId: string }>(
  { roles: ["SCHOOL_ADMIN"] },
  async ({ request, ctx, params }) => {
    const { isActive } = await readJson(request, activeBody);
    await setSubjectActive(ctx, params.subjectId, isActive);
    return apiSuccess({ id: params.subjectId, isActive });
  },
);
