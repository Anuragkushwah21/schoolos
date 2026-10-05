import { z } from "zod";

import { rupeesToMinor } from "@/lib/fee-discussion";
import {
  checkbox,
  id,
  optionalDate,
  optionalEmail,
  optionalEnum,
  optionalId,
  optionalPastDate,
  optionalPhone,
  optionalText,
  requiredPhone,
  requiredText,
} from "@/lib/validation/common";
import { GENDERS, RELATIONSHIPS } from "@/lib/validation/school";

/**
 * Family enquiries, their fee discussion, the public multi-child application
 * and the admission portal's settings.
 *
 * Repeating groups (children, custom fields) arrive from a form as
 * `children.0.firstName`, `children.1.firstName`… and are gathered into an
 * array here, so an error on the second child's class comes back as
 * `children.1.classId` and shows on that child's card.
 */

/** Gather `prefix.N.field` form keys into an array of rows, in index order. */
export function indexedRows(raw: Record<string, unknown>, prefix: string): Array<Record<string, unknown>> {
  const rows = new Map<number, Record<string, unknown>>();
  const pattern = new RegExp(`^${prefix}\\.(\\d+)\\.(\\w+)$`);
  for (const [key, value] of Object.entries(raw)) {
    const match = pattern.exec(key);
    if (!match) continue;
    const index = Number(match[1]);
    if (!rows.has(index)) rows.set(index, {});
    rows.get(index)![match[2]!] = value;
  }
  return [...rows.keys()].sort((a, b) => a - b).map((index) => rows.get(index)!);
}

/** A form (FormData) sends repeated groups flat; a JSON client may already send arrays. */
function withRows<S extends z.ZodType>(prefixes: string[], schema: S) {
  return z.preprocess((value) => {
    if (typeof value !== "object" || value === null) return value;
    const raw = value as Record<string, unknown>;
    const out: Record<string, unknown> = { ...raw };
    for (const prefix of prefixes) if (!Array.isArray(raw[prefix])) out[prefix] = indexedRows(raw, prefix);
    return out;
  }, schema);
}

const blank = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);

/** Rupees as typed ("45,000") → paise, or null when left blank. */
export const optionalRupees = z
  .preprocess((value) => (blank(value) === undefined ? undefined : (rupeesToMinor(value as string) ?? Number.NaN)), z.number({ error: "Enter an amount in rupees" }).int().min(0, "The amount cannot be negative").max(1_000_000_000, "That amount is too large").optional())
  .transform((value) => value ?? null);

export function requiredRupees(label: string) {
  return z.preprocess(
    (value) => (blank(value) === undefined ? undefined : (rupeesToMinor(value as string) ?? Number.NaN)),
    z.number({ error: `Enter ${label}` }).int().min(1, `Enter ${label}`).max(1_000_000_000, "That amount is too large"),
  );
}

export const DISCOUNT_KINDS = ["NONE", "FIXED", "PERCENT"] as const;

/** The discount as typed: rupees for FIXED, a percentage for PERCENT. Converted by the server. */
const discountNumber = z
  .preprocess((value) => (blank(value) === undefined ? undefined : Number(String(value).replace(/[,\s₹%]/g, ""))), z.number({ error: "Enter a number" }).min(0, "Cannot be negative").max(1_000_000_000).optional())
  .transform((value) => value ?? null);

export const ENQUIRY_SOURCES = ["WEBSITE", "WALK_IN", "PHONE", "REFERRAL", "OTHER"] as const;
export const ENQUIRY_STATUSES = ["NEW", "CONTACTED", "FOLLOW_UP", "CONVERTED", "CLOSED"] as const;

const enquiryChildSchema = z.object({
  id: optionalId,
  firstName: requiredText("the child's first name", 60),
  lastName: optionalText(60),
  dateOfBirth: optionalPastDate("A date of birth"),
  gender: optionalEnum(GENDERS),
  classId: z.string({ error: "Choose a class" }).trim().min(1, "Choose a class").max(64),
  streamId: optionalId,
  previousSchool: optionalText(150),
  notes: optionalText(500),
  // Fee discussion, optional when the enquiry is first taken.
  feeOriginal: optionalRupees,
  discountKind: z.enum(DISCOUNT_KINDS).default("NONE"),
  discountValue: discountNumber,
  discountReason: optionalText(120),
});

export type EnquiryChildInput = z.infer<typeof enquiryChildSchema>;

/**
 * At most 30 children on one enquiry — not a business rule, only a guard
 * against a runaway form.
 */
const parentFields = {
  source: z.enum(ENQUIRY_SOURCES).default("WALK_IN"),
  parentName: requiredText("the parent or guardian's name", 120),
  relationship: z.enum(RELATIONSHIPS).default("GUARDIAN"),
  phone: requiredPhone,
  alternatePhone: optionalPhone,
  email: optionalEmail,
  addressLine: optionalText(200),
  city: optionalText(80),
  state: optionalText(80),
  postalCode: optionalText(12),
  notes: optionalText(2000),
  children: z.array(enquiryChildSchema).min(1, "Add at least one child").max(30, "Up to 30 children on one enquiry"),
};

export const createEnquirySchema = withRows(
  ["children"],
  z.object({
    ...parentFields,
    // Family discount and follow-up, optional at creation.
    familyDiscountKind: z.enum(DISCOUNT_KINDS).default("NONE"),
    familyDiscountValue: discountNumber,
    familyDiscountReason: optionalText(120),
    discussionNotes: optionalText(2000),
    nextFollowUpOn: optionalDate,
    nextAction: optionalText(200),
    assignedToId: optionalId,
  }),
);
export type CreateEnquiryInput = z.infer<typeof createEnquirySchema>;

export const updateEnquirySchema = withRows(["children"], z.object({ enquiryId: id, ...parentFields }));
export type UpdateEnquiryInput = z.infer<typeof updateEnquirySchema>;

export const childFeeSchema = z.object({
  childId: id,
  feeOriginal: requiredRupees("the discussed fee"),
  discountKind: z.enum(DISCOUNT_KINDS).default("NONE"),
  discountValue: discountNumber,
  discountReason: optionalText(120),
  feeNotes: optionalText(1000),
});
export type ChildFeeInput = z.infer<typeof childFeeSchema>;

export const familyFeeSchema = z.object({
  enquiryId: id,
  familyDiscountKind: z.enum(DISCOUNT_KINDS).default("NONE"),
  familyDiscountValue: discountNumber,
  familyDiscountReason: optionalText(120),
  discussionNotes: optionalText(2000),
  feeStatus: z.enum(["NOT_STARTED", "DISCUSSING", "AGREED"]).default("DISCUSSING"),
});
export type FamilyFeeInput = z.infer<typeof familyFeeSchema>;

export const enquiryFollowUpSchema = z.object({
  enquiryId: id,
  note: requiredText("what happened", 1000),
  nextAction: optionalText(200),
  nextFollowUpOn: optionalDate,
  assignedToId: optionalId,
});

export const enquiryStatusSchema = z.object({
  enquiryId: id,
  status: z.enum(["NEW", "CONTACTED", "FOLLOW_UP", "CLOSED"]),
  reason: optionalText(300),
});

export const linkParentSchema = z.object({
  enquiryId: id,
  parentId: optionalId,
  /** A parent who matches only by name is linked only when the office confirms it. */
  confirmNameOnly: checkbox,
});

export const childStatusSchema = z.object({ childId: id, withdrawn: checkbox });

/** "Apply discussed discount to actual fee records?" — one row per admitted child; only ticked rows count. */
export const applyConcessionsSchema = withRows(
  ["apply"],
  z.object({
    enquiryId: id,
    confirm: checkbox,
    apply: z.array(z.object({ childId: id, include: checkbox, chargeId: optionalId, amount: optionalRupees })),
  }),
);

// -----------------------------------------------------------------------------
// Public application, several children at once
// -----------------------------------------------------------------------------

const applicantSchema = z.object({
  firstName: requiredText("the child's first name", 60),
  lastName: requiredText("the child's last name", 60),
  dateOfBirth: optionalPastDate("A date of birth"),
  gender: optionalEnum(GENDERS),
  classId: z.string({ error: "Choose a class" }).trim().min(1, "Choose a class").max(64),
  streamId: optionalId,
  previousSchool: optionalText(150),
});

export const publicApplicationSchema = withRows(
  ["children"],
  z.object({
    children: z.array(applicantSchema).min(1, "Add at least one child").max(10, "Up to 10 children in one application"),
    parentName: requiredText("your name", 120),
    parentRelationship: z.enum(RELATIONSHIPS).default("GUARDIAN"),
    parentPhone: requiredPhone,
    parentEmail: optionalEmail,
    addressLine: optionalText(200),
    city: optionalText(80),
    state: optionalText(80),
    postalCode: optionalText(12),
    notes: optionalText(1000),
    website: z.string().optional(),
  }),
);
export type PublicApplicationInput = z.infer<typeof publicApplicationSchema>;

// -----------------------------------------------------------------------------
// Admission portal settings
// -----------------------------------------------------------------------------

export const CUSTOM_FIELD_KINDS = ["TEXT", "TEXTAREA", "DATE", "SELECT"] as const;

const customFieldSchema = z.object({
  label: requiredText("the question", 100),
  kind: z.enum(CUSTOM_FIELD_KINDS).default("TEXT"),
  /** SELECT only: one choice per line or comma. */
  options: optionalText(500),
  required: checkbox,
});

const httpsLink = z
  .preprocess(blank, z.string().trim().max(500).regex(/^https:\/\//, "Use an https:// link").optional())
  .transform((value) => value ?? null);

export const admissionPortalSchema = withRows(
  ["fields"],
  z
    .object({
      opensOn: optionalDate,
      closesOn: optionalDate,
      instructions: optionalText(3000),
      mapUrl: httpsLink,
      websiteUrl: httpsLink,
      /** One highlight per line. */
      highlights: optionalText(2000),
      classIds: z.preprocess((value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]), z.array(id).max(30)),
      fields: z.array(customFieldSchema).max(10, "Up to 10 extra questions"),
    })
    .refine((data) => !data.opensOn || !data.closesOn || data.closesOn >= data.opensOn, { message: "The closing date must be on or after the opening date", path: ["closesOn"] }),
);
export type AdmissionPortalInput = z.infer<typeof admissionPortalSchema>;
