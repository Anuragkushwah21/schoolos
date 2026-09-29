import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { examIdsSchema } from "@/lib/validation/exams";
import { publishExams } from "@/server/exams/service";

/** Publish several exams' results at once: `{ examIds: [...] }`. Refused if any has marks missing. */
export const POST = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx }) => {
  const { examIds } = await readJson(request, examIdsSchema);
  return apiSuccess(await publishExams(ctx, examIds));
});
