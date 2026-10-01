import { z } from "zod";

import { id, optionalId, optionalText, requiredDate } from "@/lib/validation/common";

/** Student leave — asked for by a parent (or a student with a login), decided by the class teacher. */

export const STUDENT_LEAVE_REASONS = ["SICK", "FAMILY_FUNCTION", "MEDICAL_APPOINTMENT", "PERSONAL", "TRAVEL", "OTHER"] as const;
export const STUDENT_LEAVE_STATUSES = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const;

export const studentLeaveSchema = z
  .object({
    /** A parent's child. Ignored for a student, who can only ask for themselves. */
    studentId: optionalId,
    fromDate: requiredDate("the start date"),
    toDate: requiredDate("the end date"),
    reason: z.enum(STUDENT_LEAVE_REASONS, { error: "Choose a reason" }),
    /** Required when the reason is Other. */
    reasonText: optionalText(200),
    note: optionalText(500),
  })
  .superRefine((data, ctx) => {
    if (data.reason === "OTHER" && !data.reasonText) ctx.addIssue({ code: "custom", path: ["reasonText"], message: "Write the reason" });
    if (data.toDate < data.fromDate) ctx.addIssue({ code: "custom", path: ["toDate"], message: "The end date cannot be before the start date." });
  });
export type StudentLeaveInput = z.infer<typeof studentLeaveSchema>;

export const studentLeaveDecisionSchema = z.object({
  leaveId: id,
  decision: z.enum(["APPROVE", "REJECT"]),
  comment: optionalText(300),
});
export type StudentLeaveDecisionInput = z.infer<typeof studentLeaveDecisionSchema>;

export const studentLeaveSettingsSchema = z.object({
  backdateDays: z.coerce.number({ error: "Enter a number of days" }).int().min(0, "0 or more").max(60, "At most 60"),
});
