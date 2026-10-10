import { z } from "zod";

import { checkbox, id, optionalInt, optionalText, requiredEmail, requiredPhone, requiredText } from "@/lib/validation/common";

const list = z.preprocess((value) => (Array.isArray(value) ? value : value === undefined || value === null || value === "" ? [] : [value]), z.array(z.string().max(40)).max(40));

/** Asking SchoolOS for another campus: the school's details and what it needs. */
export const campusRequestSchema = z.object({
  name: requiredText("the school/campus name", 150),
  addressLine: optionalText(250),
  city: requiredText("the city", 80),
  state: requiredText("the state", 80),
  postalCode: z.preprocess((value) => (typeof value === "string" && value.trim() ? value.trim() : null), z.string().regex(/^\d{6}$/, "Enter a 6-digit PIN code").nullable()),
  contactName: requiredText("a contact name", 120),
  contactEmail: requiredEmail,
  contactPhone: requiredPhone,
  affiliationBoard: optionalText(80),
  expectedStudents: optionalInt(0, 100_000),
  expectedTeachers: optionalInt(0, 10_000),
  expectedStaff: optionalInt(0, 10_000),
  notes: optionalText(1000),
  modules: list,
  roles: list,
});
export type CampusRequestInput = z.infer<typeof campusRequestSchema>;

/** Correcting a pending request. */
export const campusRequestEditSchema = campusRequestSchema.extend({ requestId: id });

/** The Super Admin's decision on a request. */
export const campusApproveSchema = z.object({ requestId: id, modules: list, roles: list, reviewNote: optionalText(1000), raiseLimit: checkbox });
export const campusRejectSchema = z.object({ requestId: id, reason: requiredText("a reason (the school is told)", 1000) });
export const campusReviewSchema = z.object({ requestId: id });
export const campusSwitchSchema = z.object({ schoolId: z.string().max(64).optional().transform((value) => value || null) });
export const campusLimitSchema = z.object({ organizationId: id, campusLimit: optionalInt(1, 500) });

/** Choosing another plan (a request until SchoolOS approves). */
export const planRequestSchema = z.object({ planId: id, note: optionalText(500) });
export const planRequestIdSchema = z.object({ requestId: id });
export const planApproveSchema = z.object({ requestId: id, reviewNote: optionalText(500) });
export const planRejectSchema = z.object({ requestId: id, reason: requiredText("a reason (the school is told)", 500) });

/** One campus's switched-on optional modules (unknown keys are dropped by the service). */
export const campusModulesSchema = z.object({ schoolId: id, modules: list });
