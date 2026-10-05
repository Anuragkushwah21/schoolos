import { z } from "zod";

import { checkbox, id, optionalId, optionalText, requiredDate, requiredText } from "@/lib/validation/common";
import { STAFF_ROLES } from "@/lib/validation/operations";

/**
 * Forms and API bodies for non-teaching staff roles, permissions,
 * substitutions and drivers' pickup/drop marks. Grant keys are checked
 * against the catalogue by the services.
 */

/** Repeated checkboxes (with an empty marker so "none ticked" still arrives) or a JSON array. */
const keyList = z.preprocess(
  (value) => (value === undefined ? [] : (Array.isArray(value) ? value : [value]).filter((item) => item !== "")),
  z.array(z.string().max(60)).max(100),
);

export const roleProfileSchema = z.object({
  roleId: optionalId,
  name: requiredText("a role name", 60),
  baseRole: z.enum(STAFF_ROLES).default("OTHER"),
  description: optionalText(300),
  defaultGrants: keyList,
  /** Also give everyone already in the role exactly these grants. */
  applyToStaff: checkbox,
});

export const staffGrantsSchema = z.object({
  staffId: id,
  grants: keyList,
});

export const substitutionSchema = z.object({
  substitutionId: optionalId,
  originalStaffId: id,
  substituteStaffId: id,
  startDate: requiredDate("the start date"),
  endDate: requiredDate("the end date"),
  reason: requiredText("a reason", 200),
  notes: optionalText(500),
  grants: keyList,
  coverRoutes: checkbox,
});

export const endSubstitutionSchema = z.object({ substitutionId: id });

export const TRANSPORT_TRIPS = ["PICKUP", "DROP"] as const;
export const TRIP_STATUSES = ["PICKED_UP", "NOT_PRESENT", "DROPPED", "ISSUE"] as const;

export const tripMarkSchema = z.object({
  routeId: id,
  studentId: id,
  trip: z.enum(TRANSPORT_TRIPS),
  status: z.enum(TRIP_STATUSES),
  note: optionalText(300),
});

export const routeIssueSchema = z.object({
  routeId: id,
  note: requiredText("what happened", 500),
});
