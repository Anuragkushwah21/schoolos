import { z } from "zod";

import { id, optionalId, optionalText, requiredText } from "@/lib/validation/common";

export const COMPLAINT_CATEGORIES = ["ACADEMIC", "FEES", "TRANSPORT", "FACILITIES", "STAFF", "BULLYING", "HEALTH", "OTHER"] as const;
export const COMPLAINT_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export const COMPLAINT_STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const;

export const raiseComplaintSchema = z.object({
  /** Parents choose which child; students leave it blank (it is themselves). */
  studentId: optionalId,
  category: z.enum(COMPLAINT_CATEGORIES, { error: "Choose a category" }),
  priority: z.enum(COMPLAINT_PRIORITIES).default("MEDIUM"),
  subject: requiredText("a short subject", 150),
  description: requiredText("what happened or what you need", 4000),
});

export type RaiseComplaintInput = z.infer<typeof raiseComplaintSchema>;

export const handleComplaintSchema = z.object({
  complaintId: id,
  status: z.enum(COMPLAINT_STATUSES),
  assignedToId: optionalId,
  response: optionalText(4000),
});

export type HandleComplaintInput = z.infer<typeof handleComplaintSchema>;

export const bulkComplaintStatusSchema = z.object({
  complaintIds: z.preprocess(
    (value) => (value === undefined || value === "" ? [] : Array.isArray(value) ? value : [value]),
    z.array(id).min(1, "Tick at least one complaint").max(200),
  ),
  status: z.enum(COMPLAINT_STATUSES),
});
