import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { classTestSchema } from "@/lib/validation/exams";
import { createClassTest, listMyPapers } from "@/server/exams/service";

/** The teacher's papers to mark this session — exam papers and class tests. */
export const GET = apiRoute({ roles: ["TEACHER"] }, async ({ ctx }) => apiSuccess(await listMyPapers(ctx)));

/** Set a class test for a subject the teacher teaches that section. */
export const POST = apiRoute({ roles: ["TEACHER"] }, async ({ request, ctx }) => {
  const input = await readJson(request, classTestSchema);
  return apiSuccess(await createClassTest(ctx, input), { status: 201 });
});
