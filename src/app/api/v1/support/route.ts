import { z } from "zod";

import { apiRoute, apiSuccess, readJson, readQuery } from "@/server/api/handler";
import { SUPPORT_PRIORITIES, SUPPORT_SOURCES, SUPPORT_STATUSES, supportSchema } from "@/lib/validation/support";
import { createSupport, getSupport, listSupport } from "@/server/support/service";

const query = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum([...SUPPORT_STATUSES, "OPEN"]).optional(),
  section: z.string().max(64).optional(),
  subject: z.string().max(64).optional(),
  teacher: z.string().max(64).optional(),
  priority: z.enum(SUPPORT_PRIORITIES).optional(),
  source: z.enum(SUPPORT_SOURCES).optional(),
});

/** Students needing attention: the admin's whole school, or a teacher's own classes. */
export const GET = apiRoute({ roles: ["SCHOOL_ADMIN", "TEACHER"] }, async ({ request, ctx }) => {
  const q = readQuery(request, query);
  return apiSuccess(await listSupport(ctx, { q: q.q, status: q.status, sectionId: q.section, subjectId: q.subject, teacherId: q.teacher, priority: q.priority, source: q.source }));
});

/** Add support: `{ studentId, subjectId?, reason, reasonNote?, topic?, priority?, action, actionNote?, concernId?, teacherId? }`. */
export const POST = apiRoute({ roles: ["SCHOOL_ADMIN", "TEACHER"] }, async ({ request, ctx }) => {
  const id = await createSupport(ctx, await readJson(request, supportSchema));
  return apiSuccess(await getSupport(ctx, id), { status: 201 });
});
