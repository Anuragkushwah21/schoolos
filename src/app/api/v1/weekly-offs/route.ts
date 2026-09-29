import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { weeklyOffsSchema } from "@/lib/validation/calendar";
import { getWeeklyOffDays, setWeeklyOffDays } from "@/server/calendar/holidays";

/** The days of the week the school is normally closed, e.g. `["SUNDAY"]`. */
export const GET = apiRoute({ roles: ["SCHOOL_ADMIN", "TEACHER", "STUDENT", "PARENT"] }, async ({ ctx }) =>
  apiSuccess({ weeklyOffDays: await getWeeklyOffDays(ctx) }),
);

export const PUT = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx }) => {
  const input = await readJson(request, weeklyOffsSchema);
  await setWeeklyOffDays(ctx, input);
  return apiSuccess({ weeklyOffDays: await getWeeklyOffDays(ctx) });
});
