import { z } from "zod";

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

/** Read-only modules a School Admin may open to one staff login. */
export const STAFF_PERMISSIONS = ["VIEW_STUDENTS", "VIEW_LIBRARY", "VIEW_TRANSPORT"] as const;

export const STAFF_PERMISSION_LABEL: Record<(typeof STAFF_PERMISSIONS)[number], { label: string; hint: string }> = {
  VIEW_STUDENTS: { label: "View students", hint: "Student directory: names, classes and guardian phone numbers. No fees, marks or records." },
  VIEW_LIBRARY: { label: "View library", hint: "The catalogue and who has which book." },
  VIEW_TRANSPORT: { label: "View transport", hint: "Routes, stops, vehicles and rider counts." },
};
export const STAFF_STATUSES = EMPLOYEE_LIFECYCLE;

export const staffSchema = z.object({
  staffId: optionalId,
  employeeId: requiredText("an employee ID", 30),
  firstName: requiredText("a first name", 60),
  lastName: requiredText("a last name", 60),
  role: z.enum(STAFF_ROLES, { error: "Choose a role" }),
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
   * Modules this person may open once they have a login. Absent means "leave
   * as they are", so a CSV import or an API caller that does not mention
   * permissions never revokes them by accident; the form always sends the list.
   */
  permissions: z
    .preprocess(
      // The form sends an empty marker alongside its checkboxes so that
      // unticking every box still arrives, as [].
      (value) => (value === undefined ? undefined : (Array.isArray(value) ? value : [value]).filter((item) => item !== "")),
      z.array(z.enum(STAFF_PERMISSIONS)).optional(),
    )
    .transform((value) => (value ? [...new Set(value)] : undefined)),
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
  vehicleId: optionalId,
  driverId: optionalId,
  attendantId: optionalId,
  isActive: checkbox,
  notes: optionalText(300),
});
export type RouteInput = z.infer<typeof routeSchema>;

export const stopSchema = z.object({
  routeId: id,
  name: requiredText("the stop name", 80),
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

export const issueBookSchema = z.object({
  bookId: id,
  borrowerKind: z.enum(BORROWER_KINDS),
  /** Admission number, teacher employee ID, or staff employee ID. */
  borrowerCode: requiredText("the borrower's admission no. or employee ID", 30),
  issuedOn: requiredDate("the issue date"),
  dueOn: requiredDate("the due date"),
  notes: optionalText(200),
});
export type IssueBookInput = z.infer<typeof issueBookSchema>;

export const returnBookSchema = z.object({
  issueId: id,
  returnedOn: requiredDate("the return date"),
  finePaid: checkbox,
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

