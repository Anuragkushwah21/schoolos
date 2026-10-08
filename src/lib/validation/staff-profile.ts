import { z } from "zod";

import { grantsFrom } from "@/lib/staff-access";
import { checkbox, id, optionalDate, optionalEmail, optionalEnum, optionalInt, optionalPastDate, optionalPhone, optionalText, requiredText } from "@/lib/validation/common";
import { EMPLOYMENT_TYPES } from "@/lib/validation/operations";
import { GENDERS } from "@/lib/validation/school";

export const STAFF_DOCUMENT_TYPES = ["AADHAAR", "PAN", "QUALIFICATION", "EXPERIENCE", "PREVIOUS_EMPLOYMENT", "APPOINTMENT_LETTER", "JOINING", "OTHER"] as const;

/** Rupees as typed ("25,000") → paise; blank is null. */
const optionalRupees = z.preprocess(
  (value) => (typeof value === "string" ? value.replace(/[,\s₹]/g, "") : value),
  z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (!value) return null;
      if (!/^\d+(\.\d{1,2})?$/.test(value) || Number(value) <= 0) {
        ctx.addIssue({ code: "custom", message: "Enter an amount in rupees" });
        return z.NEVER;
      }
      return Math.round(Number(value) * 100);
    }),
);

/**
 * The staff creation wizard, all three steps in one submission. Only the name
 * and role are always required; the email is required when a login is to be
 * created. Everything else follows the school's own pace.
 */
export const staffProfileSchema = z
  .object({
    // Step 1 — personal & employment
    fullName: requiredText("the full name", 120),
    email: optionalEmail,
    phone: optionalPhone,
    designation: optionalText(80),
    department: optionalText(80),
    employeeId: optionalText(30),
    dateOfBirth: optionalPastDate("A date of birth"),
    gender: optionalEnum(GENDERS),
    addressLine: optionalText(200),
    city: optionalText(80),
    state: optionalText(80),
    postalCode: optionalText(12),
    experienceYears: optionalInt(0, 60),
    joiningDate: optionalDate,
    employmentType: optionalEnum(EMPLOYMENT_TYPES),
    salaryMinor: optionalRupees,
    emergencyContactName: optionalText(120),
    emergencyContactPhone: optionalPhone,
    notes: optionalText(500),
    // Step 2 — role & permissions
    roleProfileId: id,
    grants: z.preprocess((value) => (Array.isArray(value) ? value : typeof value === "string" && value ? [value] : []), z.array(z.string()).max(100)).transform((values) => grantsFrom(values)),
    // Login
    createLogin: checkbox,
  })
  .refine((data) => !data.createLogin || Boolean(data.email), { message: "Enter an email to create their login", path: ["email"] });

export type StaffProfileInput = z.infer<typeof staffProfileSchema>;

export const staffRoleChangeSchema = z.object({ staffId: id, roleProfileId: id, keepCustom: checkbox });
export const staffDocumentSchema = z.object({ staffId: id, type: z.enum(STAFF_DOCUMENT_TYPES), label: optionalText(80), notes: optionalText(300) });
export const documentVerificationSchema = z.object({ documentId: id, verification: z.enum(["PENDING", "VERIFIED", "REJECTED"]), notes: optionalText(300) });
