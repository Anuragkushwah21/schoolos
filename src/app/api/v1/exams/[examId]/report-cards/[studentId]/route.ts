import { apiRoute, apiSuccess } from "@/server/api/handler";
import { getReportCard } from "@/server/exams/results";

type Params = { examId: string; studentId: string };

/**
 * One student's report card. School Admin: any. Parent: a linked child's, once
 * published. Student: their own, once published. Otherwise 404.
 */
export const GET = apiRoute<Params>({ roles: ["SCHOOL_ADMIN", "PARENT", "STUDENT"] }, async ({ ctx, params }) =>
  apiSuccess(await getReportCard(ctx, params.examId, params.studentId)),
);
