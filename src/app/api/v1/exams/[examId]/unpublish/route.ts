import { apiRoute, apiSuccess } from "@/server/api/handler";
import { unpublishExam } from "@/server/exams/service";

type Params = { examId: string };

/** Withdraw published results so marks can be corrected. */
export const POST = apiRoute<Params>({ roles: ["SCHOOL_ADMIN"] }, async ({ ctx, params }) => {
  await unpublishExam(ctx, params.examId);
  return apiSuccess({ status: "DRAFT" });
});
