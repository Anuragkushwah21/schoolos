import { z } from "zod";

import { apiRoute, apiSuccess, readJson, readQuery } from "@/server/api/handler";
import { COMPLAINT_CATEGORIES, COMPLAINT_PRIORITIES, COMPLAINT_STATUSES, raiseComplaintSchema } from "@/lib/validation/complaints";
import { listComplaints, raiseComplaint } from "@/server/communication/complaints";

const query = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(COMPLAINT_STATUSES).optional(),
  category: z.enum(COMPLAINT_CATEGORIES).optional(),
  priority: z.enum(COMPLAINT_PRIORITIES).optional(),
});

/** The office: every complaint. A teacher: those assigned to them. Parent/student: their own. */
export const GET = apiRoute({ roles: ["SCHOOL_ADMIN", "TEACHER", "PARENT", "STUDENT"] }, async ({ request, ctx }) =>
  apiSuccess(await listComplaints(ctx, readQuery(request, query))),
);

/** Raise a complaint: `{ category, priority?, subject, description, studentId? }`. */
export const POST = apiRoute({ roles: ["PARENT", "STUDENT"] }, async ({ request, ctx }) => {
  const input = await readJson(request, raiseComplaintSchema);
  return apiSuccess(await raiseComplaint(ctx, input), { status: 201 });
});
