import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { admissionStatusSchema } from "@/lib/validation/website";
import { getApplication, setApplicationStatus } from "@/server/admissions/service";

/** Record a decision short of admitting: under review, waitlisted, rejected. */
export const POST = apiRoute<{ applicationId: string }>(
  { roles: ["SCHOOL_ADMIN"] },
  async ({ request, ctx, params }) => {
    const input = await readJson(request, admissionStatusSchema, {
      applicationId: params.applicationId,
    });
    await setApplicationStatus(ctx, input);
    return apiSuccess(await getApplication(ctx, params.applicationId));
  },
);
