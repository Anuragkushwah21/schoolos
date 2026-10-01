import { z } from "zod";

import {
  checkbox,
  id,
  optionalPastDate,
  optionalEmail,
  optionalEnum,
  optionalId,
  optionalInt,
  optionalPhone,
  optionalText,
  requiredPhone,
  requiredText,
} from "@/lib/validation/common";
import { GENDERS, RELATIONSHIPS } from "@/lib/validation/school";

const hexColor = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #1e40af");

const httpsUrl = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((value) => value || null)
  .refine((value) => value === null || /^https:\/\//.test(value), "Use an https:// link");

export const websiteProfileSchema = z.object({
  name: requiredText("the school's name", 120),
  shortName: optionalText(30),
  about: optionalText(3000),
  principalName: optionalText(120),
  principalMessage: optionalText(3000),
  establishedYear: optionalInt(1800, new Date().getFullYear()),
  affiliationBoard: optionalText(60),
  email: optionalEmail,
  phone: optionalPhone,
  addressLine: optionalText(200),
  city: optionalText(80),
  state: optionalText(80),
  postalCode: optionalText(12),
  logoUrl: httpsUrl,
  bannerUrl: httpsUrl,
  primaryColor: hexColor,
  secondaryColor: hexColor,
});

export type WebsiteProfileInput = z.infer<typeof websiteProfileSchema>;

/** Slugs the public site already uses for its own sections. */
export const RESERVED_PAGE_SLUGS = ["notices", "events", "admissions", "contact", "gallery"];

export const schoolPageSchema = z.object({
  pageId: z.string().optional(),
  title: requiredText("a title", 80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Enter a web address")
    .max(40, "Keep the address under 40 characters")
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens, e.g. fee-structure")
    .refine((slug) => !RESERVED_PAGE_SLUGS.includes(slug), "That address is used by the site itself"),
  body: requiredText("the page content", 20000),
  sortOrder: optionalInt(0, 999),
  isPublished: checkbox,
});

export type SchoolPageInput = z.infer<typeof schoolPageSchema>;

export const mediaSchema = z.object({
  url: z.string().trim().min(1, "Enter an image link").max(500).regex(/^https:\/\//, "Use an https:// link"),
  caption: optionalText(150),
});

// -----------------------------------------------------------------------------
// Admissions
// -----------------------------------------------------------------------------

/** The public admission form. `website` is a honeypot, as on registration. */
export const admissionApplicationSchema = z.object({
  studentFirstName: requiredText("the child's first name", 60),
  studentLastName: requiredText("the child's last name", 60),
  dateOfBirth: optionalPastDate("A date of birth"),
  gender: optionalEnum(GENDERS),
  previousSchool: optionalText(150),
  requestedClassId: id,
  requestedStreamId: optionalId,
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
});

export type AdmissionApplicationInput = z.infer<typeof admissionApplicationSchema>;

export const admissionStatusSchema = z.object({
  applicationId: id,
  status: z.enum(["UNDER_REVIEW", "WAITLISTED", "REJECTED"]),
  reviewNotes: optionalText(1000),
});

export const acceptAdmissionSchema = z.object({
  applicationId: id,
  sectionId: id,
  /** Where the section shares seats among streams; blank uses the stream applied for. */
  streamId: optionalId,
  rollNumber: optionalText(10),
  admissionNumber: optionalText(30),
  reviewNotes: optionalText(1000),
});
