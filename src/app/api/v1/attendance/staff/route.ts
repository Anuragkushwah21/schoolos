import { z } from "zod";

import { apiRoute, apiSuccess, readJson, readQuery } from "@/server/api/handler";
import { today } from "@/lib/dates";
import { dateQuery, staffRegisterQuery } from "@/lib/validation/api";
import { id } from "@/lib/validation/common";
import {
  STAFF_ATTENDANCE_STATUSES,
  getStaffRegister,
  markStaffAttendance,
} from "@/server/attendance/service";

export const GET = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx }) => {
  const { date } = readQuery(request, staffRegisterQuery);
  const on = date ?? today();
  return apiSuccess(await getStaffRegister(ctx, on), { meta: { date: on } });
});

const staffBody = z.object({
  date: dateQuery,
  entries: z
    .array(
      z.object({
        teacherId: id,
        status: z.enum(STAFF_ATTENDANCE_STATUSES as [string, ...string[]]),
        remarks: z.string().trim().max(200).optional().transform((value) => value || null),
      }),
    )
    .min(1, "Mark at least one teacher"),
});

export const POST = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx }) => {
  const input = await readJson(request, staffBody);
  const { saved } = await markStaffAttendance(ctx, {
    date: input.date,
    entries: input.entries.map((entry) => ({
      teacherId: entry.teacherId,
      status: entry.status as (typeof STAFF_ATTENDANCE_STATUSES)[number],
      remarks: entry.remarks,
    })),
  });
  return apiSuccess(await getStaffRegister(ctx, input.date), { meta: { saved } });
});
