"use server";

import { z } from "zod";

import { type ActionResult, parseFormData, successResult } from "@/lib/action-result";
import { holidaySchema, weeklyOffsSchema } from "@/lib/validation/calendar";
import { id } from "@/lib/validation/common";
import { requireTenantForAction } from "@/server/auth/current-user";
import { deleteHoliday, saveHoliday, setWeeklyOffDays } from "@/server/calendar/holidays";
import { performAction } from "@/server/perform-action";

type Result = ActionResult<undefined>;

/** Holidays change registers, dashboards and every portal's calendar. */
const EVERYWHERE = ["/school-admin", "/teacher", "/student", "/parent"];

export async function saveHolidayAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN");
      await saveHoliday(ctx, parseFormData(holidaySchema, formData));
      return successResult("Holiday saved.");
    },
    { revalidate: EVERYWHERE, redirectTo: "/school-admin/holidays" },
  );
}

export async function deleteHolidayAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN");
      const { holidayId } = parseFormData(z.object({ holidayId: id }), formData);
      await deleteHoliday(ctx, holidayId);
      return successResult("Holiday deleted.");
    },
    { revalidate: EVERYWHERE, redirectTo: "/school-admin/holidays" },
  );
}

export async function saveWeeklyOffsAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN");
      await setWeeklyOffDays(ctx, parseFormData(weeklyOffsSchema, formData));
      return successResult("Weekly offs saved.");
    },
    { revalidate: EVERYWHERE },
  );
}
