import { apiRoute, apiSuccess, readJson, readQuery } from "@/server/api/handler";
import { holidaysQuery } from "@/lib/validation/api";
import { holidaySchema } from "@/lib/validation/calendar";
import { getHoliday, listHolidays, saveHoliday } from "@/server/calendar/holidays";

/**
 * The school's holidays. Every member of the school may read them; only a
 * School Admin may add one. `?from=` and `?to=` narrow to holidays touching
 * that range.
 */
export const GET = apiRoute({ roles: ["SCHOOL_ADMIN", "TEACHER", "STUDENT", "PARENT"] }, async ({ request, ctx }) => {
  const { from, to } = readQuery(request, holidaysQuery);
  return apiSuccess(await listHolidays(ctx, { from, to }));
});

/**
 * Declare a holiday. Days that already hold attendance are refused with 409
 * unless the body sets `clearAttendance: true`.
 */
export const POST = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx }) => {
  const input = await readJson(request, holidaySchema, { holidayId: undefined });
  const id = await saveHoliday(ctx, input);
  return apiSuccess(await getHoliday(ctx, id), { status: 201 });
});
