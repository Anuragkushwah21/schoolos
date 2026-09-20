import { z } from "zod";

import { apiRoute, apiSuccess, readJson, readQuery } from "@/server/api/handler";
import { today } from "@/lib/dates";
import { dateQuery, registerQuery } from "@/lib/validation/api";
import { id } from "@/lib/validation/common";
import { ATTENDANCE_STATUSES, getRegister, markAttendance } from "@/server/attendance/service";

/**
 * A section's register for one day (today unless `?date=`).
 *
 * `getRegister` refuses any section the caller may not access, so a teacher
 * cannot read another class's register by editing the query.
 */
export const GET = apiRoute({ roles: ["SCHOOL_ADMIN", "TEACHER"] }, async ({ request, ctx }) => {
  const { section, date } = readQuery(request, registerQuery);
  return apiSuccess(await getRegister(ctx, section, date ?? today()));
});

const markBody = z.object({
  sectionId: id,
  date: dateQuery,
  entries: z
    .array(
      z.object({
        studentId: id,
        status: z.enum(ATTENDANCE_STATUSES as [string, ...string[]]),
        remarks: z.string().trim().max(200).optional().transform((value) => value || null),
      }),
    )
    .min(1, "Mark at least one student"),
});

/**
 * Save a register. Every student in the body must be enrolled in the section;
 * one that is not fails the whole save rather than being skipped.
 */
export const POST = apiRoute({ roles: ["SCHOOL_ADMIN", "TEACHER"] }, async ({ request, ctx }) => {
  const input = await readJson(request, markBody);
  const { saved } = await markAttendance(ctx, {
    sectionId: input.sectionId,
    date: input.date,
    entries: input.entries.map((entry) => ({
      studentId: entry.studentId,
      status: entry.status as (typeof ATTENDANCE_STATUSES)[number],
      remarks: entry.remarks,
    })),
  });
  return apiSuccess(await getRegister(ctx, input.sectionId, input.date), { meta: { saved } });
});
