import { z } from "zod";

import { MAX_HOLIDAY_DAYS, spanDays } from "@/lib/calendar";
import { checkbox, optionalDate, optionalId, optionalText, requiredDate, requiredText } from "@/lib/validation/common";

export const ALL_DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const;

/**
 * A holiday. Past dates are accepted — a school records an unplanned closure
 * after the fact — and so are future ones, which is the usual case.
 *
 * A blank end date means a one-day holiday.
 */
export const holidaySchema = z
  .object({
    holidayId: optionalId,
    title: requiredText("a name for the holiday", 120),
    description: optionalText(1000),
    startDate: requiredDate("the first day of the holiday"),
    endDate: optionalDate,
    /** Consent to delete attendance already recorded on these days. */
    clearAttendance: checkbox,
  })
  .transform(({ endDate, ...data }) => ({ ...data, endDate: endDate ?? data.startDate }))
  .refine((data) => data.endDate >= data.startDate, {
    message: "The holiday cannot end before it starts",
    path: ["endDate"],
  })
  .refine((data) => spanDays(data.startDate, data.endDate) <= MAX_HOLIDAY_DAYS, {
    message: `A single holiday can be at most ${MAX_HOLIDAY_DAYS} days. Split longer breaks into parts.`,
    path: ["endDate"],
  });

export type HolidayInput = z.infer<typeof holidaySchema>;

/** Checkboxes named `weeklyOffDays`: none, one (a string) or several (an array). */
export const weeklyOffsSchema = z.object({
  weeklyOffDays: z
    .preprocess(
      (value) => (value === undefined || value === "" ? [] : Array.isArray(value) ? value : [value]),
      z.array(z.enum(ALL_DAYS, { error: "Choose days of the week" })),
    )
    .transform((days) => ALL_DAYS.filter((day) => days.includes(day)))
    .refine((days) => days.length < ALL_DAYS.length, "A school needs at least one working day in the week"),
});

export type WeeklyOffsInput = z.infer<typeof weeklyOffsSchema>;
