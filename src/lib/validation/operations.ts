import { z } from "zod";

import { grantsFrom } from "@/lib/staff-access";

import { EMPLOYEE_LIFECYCLE } from "@/lib/validation/lifecycle";

import {
  checkbox,
  id,
  optionalDate,
  optionalEmail,
  optionalId,
  optionalPastDate,
  optionalPhone,
  optionalText,
  optionalTime,
  requiredDate,
  requiredInt,
  requiredText,
} from "@/lib/validation/common";

/**
 * Staff, transport, library and inventory — shared by forms, actions and API.
 */

export const STAFF_ROLES = [
  "ACCOUNTANT",
  "RECEPTIONIST",
  "LIBRARIAN",
  "DRIVER",
  "TRANSPORT_ATTENDANT",
  "LAB_ASSISTANT",
  "PEON",
  "OFFICE_STAFF",
  "COORDINATOR",
  "SECURITY",
  "OTHER",
] as const;

export const STAFF_STATUSES = EMPLOYEE_LIFECYCLE;

/** A list field from a form (repeated inputs, with an empty marker) or JSON. Absent stays absent. */
const grantList = z.preprocess(
  // The form sends an empty marker alongside its checkboxes so that
  // unticking every box still arrives, as [].
  (value) => (value === undefined ? undefined : (Array.isArray(value) ? value : [value]).filter((item) => item !== "")),
  z.array(z.string().max(60)).max(100).optional(),
);

export const staffSchema = z
  .object({
    staffId: optionalId,
    employeeId: requiredText("an employee ID", 30),
    firstName: requiredText("a first name", 60),
    lastName: requiredText("a last name", 60),
    /** The role profile (built-in or custom). Its designation decides `role`. */
    roleProfileId: optionalId,
    /** The designation, for callers that do not use role profiles (CSV, older API clients). */
    role: z.enum(STAFF_ROLES, { error: "Choose a role" }).optional(),
    designation: optionalText(80),
    department: optionalText(80),
    phone: optionalPhone,
    email: optionalEmail,
    /** Joining may be a future date for someone starting next month. */
    joiningDate: optionalDate,
    /** New staff start ACTIVE; later changes go through "Change status". Absent = unchanged. */
    status: z.enum(STAFF_STATUSES).optional(),
    notes: optionalText(500),
    /**
     * What this person may do (grant keys). Absent means "leave as they are",
     * so a CSV import or an API caller that does not mention them never
     * revokes them by accident; a new staff member then starts with their
     * role's defaults. The old permission names are still understood.
     */
    grants: grantList,
    /** The old name for `grants`, from API clients written before 5 Oct 2026. */
    permissions: grantList,
  })
  .superRefine((data, ctx) => {
    if (!data.roleProfileId && !data.role) ctx.addIssue({ code: "custom", path: ["roleProfileId"], message: "Choose a role" });
  })
  .transform(({ permissions, grants, ...rest }) => {
    const asked = grants ?? permissions;
    return { ...rest, grants: asked ? grantsFrom(asked) : undefined };
  });
export type StaffInput = z.infer<typeof staffSchema>;

export const VEHICLE_TYPES = ["BUS", "VAN", "CAR", "OTHER"] as const;
export const VEHICLE_STATUSES = ["ACTIVE", "MAINTENANCE", "INACTIVE"] as const;

export const vehicleSchema = z.object({
  vehicleId: optionalId,
  registrationNo: requiredText("the registration number", 20).transform((value) => value.toUpperCase().replace(/\s+/g, " ")),
  type: z.enum(VEHICLE_TYPES),
  capacity: requiredInt(1, 120),
  status: z.enum(VEHICLE_STATUSES).default("ACTIVE"),
  notes: optionalText(300),
});
export type VehicleInput = z.infer<typeof vehicleSchema>;

export const routeSchema = z.object({
  routeId: optionalId,
  name: requiredText("a route name", 80),
  /** Route number as painted on the bus, e.g. "R-3". */
  code: optionalText(20),
  startPoint: optionalText(120),
  endPoint: optionalText(120),
  vehicleId: optionalId,
  driverId: optionalId,
  attendantId: optionalId,
  isActive: checkbox,
  notes: optionalText(300),
});
export type RouteInput = z.infer<typeof routeSchema>;

export const stopSchema = z.object({
  routeId: id,
  /** Set when editing a stop; absent when adding one. */
  stopId: optionalId,
  name: requiredText("the stop name", 80),
  location: optionalText(160),
  sequence: requiredInt(1, 200),
  pickupMinute: optionalTime,
  dropMinute: optionalTime,
});
export type StopInput = z.infer<typeof stopSchema>;

const idList = z.preprocess(
  (value) => (value === undefined || value === "" ? [] : Array.isArray(value) ? value : [value]),
  z.array(id).min(1, "Tick at least one student").max(1000),
);

export const assignTransportSchema = z.object({
  routeId: id,
  stopId: optionalId,
  studentIds: idList,
  startDate: requiredDate("the start date"),
});
export type AssignTransportInput = z.infer<typeof assignTransportSchema>;

export const bookSchema = z.object({
  bookId: optionalId,
  title: requiredText("the title", 200),
  author: optionalText(120),
  isbn: z
    .preprocess((value) => (typeof value === "string" ? value.replace(/[\s-]/g, "") : value), optionalText(17))
    .refine((value) => value === null || /^(\d{9}[\dX]|\d{13})$/i.test(value), "Enter a 10 or 13 digit ISBN"),
  category: optionalText(60),
  publisher: optionalText(120),
  shelf: optionalText(40),
  quantity: requiredInt(0, 10_000),
  isActive: checkbox,
});
export type BookInput = z.infer<typeof bookSchema>;

export const BORROWER_KINDS = ["STUDENT", "TEACHER", "STAFF"] as const;

export const issueBookSchema = z
  .object({
    bookId: id,
    /** The physical copy. Without one (older API clients), the first copy on the shelf. */
    copyId: optionalId,
    borrowerKind: z.enum(BORROWER_KINDS),
    /** The student picked in the desk's search; re-checked in this school on the server. */
    studentId: optionalId,
    /** Admission number, teacher employee ID, or staff employee ID. */
    borrowerCode: optionalText(30),
    issuedOn: requiredDate("the issue date"),
    dueOn: requiredDate("the due date"),
    notes: optionalText(200),
  })
  .refine((data) => Boolean(data.borrowerCode || (data.borrowerKind === "STUDENT" && data.studentId)), {
    message: "Search for the student, or enter the admission no. or employee ID",
    path: ["borrowerCode"],
  })
  .transform((data) => ({ ...data, borrowerCode: data.borrowerCode ?? "" }));
export type IssueBookInput = z.infer<typeof issueBookSchema>;

export const libraryRulesSchema = z.object({
  loanDays: z.coerce.number({ error: "Enter the loan period" }).int().min(1, "At least 1 day").max(60, "At most 60 days"),
  maxLoans: z.coerce.number({ error: "Enter a limit" }).int().min(1, "At least 1 book").max(20, "At most 20 books"),
  finePerDayRupees: z.coerce.number({ error: "Enter the fine" }).min(0, "Cannot be negative").max(1000, "At most ₹1000 a day"),
});

export const returnBookSchema = z.object({
  issueId: id,
  returnedOn: requiredDate("the return date"),
  finePaid: checkbox,
});

export const renewLoanSchema = z.object({
  issueId: id,
  dueOn: requiredDate("the new due date"),
});

export const ASSET_CATEGORIES = ["COMPUTER", "FURNITURE", "PROJECTOR", "LAB_EQUIPMENT", "SPORTS", "STATIONERY", "OTHER"] as const;
export const ASSET_STATUSES = ["ACTIVE", "IN_REPAIR", "DAMAGED", "LOST", "DISPOSED"] as const;
export const ASSET_CONDITIONS = ["NEW", "GOOD", "FAIR", "POOR"] as const;

export const assetSchema = z.object({
  assetId: optionalId,
  code: requiredText("an asset code", 40),
  name: requiredText("a name", 120),
  category: z.enum(ASSET_CATEGORIES),
  /** A purchase is history: it cannot be in the future. */
  purchaseDate: optionalPastDate("A purchase date"),
  purchaseCostMinor: z
    .preprocess((value) => (value === "" || value === undefined || value === null ? undefined : value), z.coerce.number().min(0).max(100_000_000).optional())
    .transform((value) => (value === undefined ? null : Math.round(value * 100))),
  quantity: requiredInt(1, 100_000),
  location: optionalText(80),
  assignedTo: optionalText(80),
  condition: z.enum(ASSET_CONDITIONS).default("GOOD"),
  status: z.enum(ASSET_STATUSES).default("ACTIVE"),
  notes: optionalText(500),
});
export type AssetInput = z.infer<typeof assetSchema>;

export const assetStatusSchema = z.object({
  assetIds: z.preprocess(
    (value) => (value === undefined || value === "" ? [] : Array.isArray(value) ? value : [value]),
    z.array(id).min(1, "Tick at least one asset").max(500),
  ),
  status: z.enum(ASSET_STATUSES),
  note: optionalText(200),
});

