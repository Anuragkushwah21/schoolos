import { z } from "zod";

import { id, optionalText, requiredTime } from "@/lib/validation/common";

export const DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"] as const;

export const slotSchema = z
  .object({
    sectionId: id,
    subjectId: id,
    teacherId: id,
    dayOfWeek: z.enum(DAYS, { error: "Choose a day" }),
    startMinute: requiredTime("a start time"),
    endMinute: requiredTime("an end time"),
    room: optionalText(20),
  })
  .refine((data) => data.endMinute > data.startMinute, {
    message: "The period must end after it starts",
    path: ["endMinute"],
  })
  .refine((data) => data.endMinute - data.startMinute <= 240, {
    message: "A period cannot be longer than four hours",
    path: ["endMinute"],
  });

export type SlotInput = z.infer<typeof slotSchema>;
