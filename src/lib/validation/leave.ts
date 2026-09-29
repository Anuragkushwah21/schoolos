import { z } from "zod";

import { id, optionalText, requiredDate, requiredText } from "@/lib/validation/common";

export const LEAVE_TYPES = ["CASUAL", "SICK", "EARNED", "MATERNITY", "PATERNITY", "UNPAID", "OTHER"] as const;

/**
 * A leave request. The range is checked here; how far back or ahead it may
 * reach is a business rule in the service, which is the same for the form and
 * the API.
 */
export const leaveRequestSchema = z
  .object({
    type: z.enum(LEAVE_TYPES, { error: "Choose the kind of leave" }),
    startDate: requiredDate("the first day of leave"),
    endDate: requiredDate("the last day of leave"),
    reason: requiredText("a reason", 500),
  })
  .refine((data) => data.endDate >= data.startDate, {
    message: "Leave cannot end before it starts",
    path: ["endDate"],
  });

export type LeaveRequestInput = z.infer<typeof leaveRequestSchema>;

const idList = z.preprocess(
  (value) => (value === undefined || value === "" ? [] : Array.isArray(value) ? value : [value]),
  z.array(id).min(1, "Choose at least one request").max(100),
);

export const leaveDecisionSchema = z.object({
  leaveIds: idList,
  decision: z.enum(["APPROVED", "REJECTED"]),
  note: optionalText(300),
});

export type LeaveDecisionInput = z.infer<typeof leaveDecisionSchema>;
