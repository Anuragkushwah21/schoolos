import { z } from "zod";

import { apiRoute, apiSuccess, readJson, readQuery } from "@/server/api/handler";
import { today } from "@/lib/dates";
import { dateQuery } from "@/lib/validation/api";
import { id } from "@/lib/validation/common";
import { assignSubstitute, getCoverPlan } from "@/server/classwork/substitutes";

/** Who is away on `?date=` (default today), their periods, and who is free to cover each. */
export const GET = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx }) => {
  const { date } = readQuery(request, z.object({ date: dateQuery.optional() }));
  return apiSuccess(await getCoverPlan(ctx, date ?? today()));
});

/** Assign a substitute: `{ timetableSlotId, date, teacherId }`. Clashes are refused. */
export const POST = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx }) => {
  const input = await readJson(request, z.object({ timetableSlotId: id, date: dateQuery, teacherId: id }));
  return apiSuccess(await assignSubstitute(ctx, input), { status: 201 });
});
