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
import { schoolClosureOn } from "@/server/calendar/holidays";

export const GET = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx }) => {
  const { date } = readQuery(request, staffRegisterQuery);
  const on = date ?? today();
  const [rows, closure] = await Promise.all([getStaffRegister(ctx, on), schoolClosureOn(ctx, on)]);
  return apiSuccess(rows, { meta: { date: on, closure: closure ? { kind: closure.kind, label: closure.label } : null } });
});

const staffBody = z.object({
  date: dateQuery,
  entries: z
    .array(
      z.object({
        /** One of the two: a teacher, or a non-teaching staff member. */
        teacherId: id.optional(),
        staffMemberId: id.optional(),
        status: z.enum(STAFF_ATTENDANCE_STATUSES as [string, ...string[]]),
        remarks: z.string().trim().max(200).optional().transform((value) => value || null),
      }),
    )
    .min(1, "Mark at least one person"),
});

export const POST = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx }) => {
  const input = await readJson(request, staffBody);
  const { saved } = await markStaffAttendance(ctx, {
    date: input.date,
    entries: input.entries.map((entry) => ({
      teacherId: entry.teacherId ?? null,
      staffMemberId: entry.staffMemberId ?? null,
      status: entry.status as (typeof STAFF_ATTENDANCE_STATUSES)[number],
      remarks: entry.remarks,
    })),
  });
  return apiSuccess(await getStaffRegister(ctx, input.date), { meta: { saved } });
});
