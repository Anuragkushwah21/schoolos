import { z } from "zod";

import { CONCERN_STATUSES, parentConcernSchema, SUPPORT_PRIORITIES, SUPPORT_SOURCES, teacherConcernSchema } from "@/lib/validation/support";
import { apiRoute, apiSuccess, readJson, readQuery } from "@/server/api/handler";
import { listConcerns, raiseParentConcern, raiseTeacherConcern } from "@/server/support/concerns";

const filters = z.object({
  q: z.string().trim().max(60).optional(),
  status: z.enum([...CONCERN_STATUSES, "OPEN_ALL", "ALL"]).optional(),
  studentId: z.string().max(40).optional(),
  classId: z.string().max(40).optional(),
  sectionId: z.string().max(40).optional(),
  streamId: z.string().max(40).optional(),
  subjectId: z.string().max(40).optional(),
  teacherId: z.string().max(40).optional(),
  raisedBy: z.enum(SUPPORT_SOURCES).optional(),
  priority: z.enum(SUPPORT_PRIORITIES).optional(),
});

/**
 * Parent–teacher concerns the caller may see: all in the school (School
 * Admin), those routed to them (teacher), or their own children's (parent).
 * Filters are narrowing only; they never widen what a role can see.
 */
export const GET = apiRoute({ roles: ["SCHOOL_ADMIN", "TEACHER", "PARENT"] }, async ({ request, ctx }) => {
  return apiSuccess(await listConcerns(ctx, readQuery(request, filters)));
});

/**
 * Raise a concern. Parent: `{ studentId, subjectId, type, message }` — routed
 * by the school, never to a teacher named in the request. Teacher: the same
 * plus `priority`, only for a subject they teach that student.
 */
export const POST = apiRoute({ roles: ["PARENT", "TEACHER"] }, async ({ request, ctx }) => {
  const concern =
    ctx.user.role === "PARENT"
      ? await raiseParentConcern(ctx, await readJson(request, parentConcernSchema))
      : await raiseTeacherConcern(ctx, await readJson(request, teacherConcernSchema));
  return apiSuccess(concern, { status: 201 });
});
