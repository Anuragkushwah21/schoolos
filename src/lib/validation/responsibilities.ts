import { z } from "zod";

import { RESPONSIBILITY_TYPE_KEYS } from "@/lib/responsibilities";
import { id, optionalDate, optionalText, requiredDate, requiredText } from "@/lib/validation/common";

const fields = {
  title: requiredText("a title", 160),
  description: optionalText(2000),
  type: z.enum(RESPONSIBILITY_TYPE_KEYS, { error: "Choose a type" }),
  assignedToId: id,
  startDate: requiredDate("a start date"),
  endDate: optionalDate,
  priority: z.enum(["LOW", "NORMAL", "HIGH"]).default("NORMAL"),
  notes: optionalText(1000),
};

const datesInOrder = (value: { startDate: Date; endDate: Date | null }) => !value.endDate || value.endDate >= value.startDate;
const datesMessage = { message: "The end date cannot be before the start date", path: ["endDate"] };

/** Assigning a responsibility to a teacher or staff member. */
export const responsibilityCreateSchema = z.object(fields).refine(datesInOrder, datesMessage);
export type ResponsibilityCreateInput = z.infer<typeof responsibilityCreateSchema>;

/** Editing one — changing the person reassigns it. */
export const responsibilityUpdateSchema = z.object({ responsibilityId: id, ...fields }).refine(datesInOrder, datesMessage);
export type ResponsibilityUpdateInput = z.infer<typeof responsibilityUpdateSchema>;

/** Cancel / confirm / start / complete: just the record. */
export const responsibilityIdSchema = z.object({ responsibilityId: id });

/** The assignee's progress note. */
export const responsibilityProgressSchema = z.object({ responsibilityId: id, progressNote: requiredText("a progress note", 1000) });
