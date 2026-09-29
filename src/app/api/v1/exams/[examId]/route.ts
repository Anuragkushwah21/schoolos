import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { updateExamSchema } from "@/lib/validation/exams";
import { deleteExam, getExamDetail, updateExam } from "@/server/exams/service";

type Params = { examId: string };

/** The exam, its papers and every student's tabulated result. */
export const GET = apiRoute<Params>({ roles: ["SCHOOL_ADMIN"] }, async ({ ctx, params }) =>
  apiSuccess(await getExamDetail(ctx, params.examId)),
);

export const PUT = apiRoute<Params>({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx, params }) => {
  await updateExam(ctx, await readJson(request, updateExamSchema, { examId: params.examId }));
  return apiSuccess(await getExamDetail(ctx, params.examId));
});

/** Draft exams only; a published exam must be unpublished first. */
export const DELETE = apiRoute<Params>({ roles: ["SCHOOL_ADMIN"] }, async ({ ctx, params }) => {
  await deleteExam(ctx, params.examId);
  return apiSuccess({ deleted: true });
});
