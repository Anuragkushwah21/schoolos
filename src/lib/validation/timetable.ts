import { z } from "zod";

import { id, optionalId, requiredTime } from "@/lib/validation/common";

export const DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"] as const;

const periodFields = {
  subjectId: id,
  teacherId: id,
  dayOfWeek: z.enum(DAYS, { error: "Choose a day" }),
  startMinute: requiredTime("a start time"),
  endMinute: requiredTime("an end time"),
  /** A room from School Setup → Rooms; blank for no room. */
  roomId: optionalId,
};

function withTimeRules<T extends z.ZodType<{ startMinute: number; endMinute: number }>>(schema: T) {
  return schema
    .refine((data) => data.endMinute > data.startMinute, {
      message: "The period must end after it starts",
      path: ["endMinute"],
    })
    .refine((data) => data.endMinute - data.startMinute <= 240, {
      message: "A period cannot be longer than four hours",
      path: ["endMinute"],
    });
}

export const slotSchema = withTimeRules(z.object({ sectionId: id, ...periodFields }));
export type SlotInput = z.infer<typeof slotSchema>;

/** Editing a period: everything but its section. */
export const slotUpdateSchema = withTimeRules(z.object({ slotId: id, ...periodFields }));
export type SlotUpdateInput = z.infer<typeof slotUpdateSchema>;
