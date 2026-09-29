import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { holidaySchema } from "@/lib/validation/calendar";
import { deleteHoliday, getHoliday, saveHoliday } from "@/server/calendar/holidays";

type Params = { holidayId: string };

export const GET = apiRoute<Params>(
  { roles: ["SCHOOL_ADMIN", "TEACHER", "STUDENT", "PARENT"] },
  async ({ ctx, params }) => apiSuccess(await getHoliday(ctx, params.holidayId)),
);

export const PUT = apiRoute<Params>({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx, params }) => {
  const input = await readJson(request, holidaySchema, { holidayId: params.holidayId });
  await saveHoliday(ctx, input);
  return apiSuccess(await getHoliday(ctx, params.holidayId));
});

export const DELETE = apiRoute<Params>({ roles: ["SCHOOL_ADMIN"] }, async ({ ctx, params }) => {
  await deleteHoliday(ctx, params.holidayId);
  return apiSuccess({ deleted: true });
});
