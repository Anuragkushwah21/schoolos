import { z } from "zod";

import { id, optionalText, requiredPhone, requiredText } from "@/lib/validation/common";

const vehicle = z
  .string()
  .trim()
  .max(20, "At most 20 characters")
  .optional()
  .transform((value) => (value ? value.toUpperCase().replace(/\s+/g, " ") : null));

const visitorFields = {
  name: requiredText("the visitor's name", 120),
  phone: requiredPhone,
  purpose: requiredText("the purpose of the visit", 200),
  personToMeet: requiredText("whom they came to meet", 120),
  vehicleNo: vehicle,
  notes: optionalText(500),
};

/**
 * Logging a visitor at the gate. There is no date or time to enter: a visitor
 * comes in now, so the entry is stamped with the moment it is saved — never
 * another day or hour (and the exit likewise, when they are marked out).
 */
export const visitorEntrySchema = z.object({
  ...visitorFields,
  /** Turned away at the gate instead of let in. */
  denied: z.preprocess((value) => value === "on" || value === "true" || value === true, z.boolean()).default(false),
});
export type VisitorEntryInput = z.infer<typeof visitorEntrySchema>;

/** Correcting a visit's details and status. The entry and exit times stay as stamped. */
export const visitorUpdateSchema = z.object({
  visitorId: id,
  ...visitorFields,
  status: z.enum(["INSIDE", "LEFT", "DENIED"]),
});
export type VisitorUpdateInput = z.infer<typeof visitorUpdateSchema>;

/** Marking a visitor out: stamped with the moment it is saved. */
export const visitorExitSchema = z.object({ visitorId: id });
