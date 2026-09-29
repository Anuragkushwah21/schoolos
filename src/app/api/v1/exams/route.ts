import { z } from "zod";

import { apiRoute, apiSuccess, readJson, readQuery } from "@/server/api/handler";
import { createExamSchema } from "@/lib/validation/exams";
import { createExams, listExams } from "@/server/exams/service";

const query = z.object({
  section: z.string().trim().optional(),
  status: z.enum(["DRAFT", "PUBLISHED"]).optional(),
});

/** This session's exams with marks-entry progress. School Admin. */
export const GET = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx }) => {
  const { section, status } = readQuery(request, query);
  return apiSuccess(await listExams(ctx, { sectionId: section, status }));
});

/**
 * Create an exam for one or more sections: `{ name, sectionIds, startDate,
 * endDate, papers: [{ subjectId, maxMarks, passMarks?, date? }] }`. All or
 * nothing.
 */
export const POST = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx }) => {
  const input = await readJson(request, createExamSchema);
  return apiSuccess(await createExams(ctx, input), { status: 201 });
});
