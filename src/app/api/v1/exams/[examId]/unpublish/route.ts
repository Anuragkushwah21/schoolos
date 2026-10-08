import { z } from "zod";

import { requiredText } from "@/lib/validation/common";
import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { unpublishExam } from "@/server/exams/service";

type Params = { examId: string };

/** Withdraw published results so marks can be corrected: `{ reason }` is required and goes on the audit log. */
export const POST = apiRoute<Params>({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx, params }) => {
  const { reason } = await readJson(request, z.object({ reason: requiredText("why the results are being withdrawn", 300) }));
  await unpublishExam(ctx, params.examId, reason);
  return apiSuccess({ status: "DRAFT" });
});
