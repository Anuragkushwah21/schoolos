"use server";

import type { Route } from "next";

import { type ActionResult, parseFormData, successResult } from "@/lib/action-result";
import { endSubstitutionSchema, roleProfileSchema, routeIssueSchema, staffGrantsSchema, substitutionSchema, tripMarkSchema } from "@/lib/validation/staff-roles";
import { id } from "@/lib/validation/common";
import { requireTenantForAction } from "@/server/auth/current-user";
import { setStaffGrants } from "@/server/operations/staff";
import { performAction } from "@/server/perform-action";
import { saveRoleProfile, setRoleArchived } from "@/server/staff/roles";
import { endSubstitution, saveSubstitution } from "@/server/staff/substitutions";
import { markTrip, reportRouteIssue } from "@/server/transport/driver";

type Result = ActionResult<undefined>;

const admin = () => requireTenantForAction("SCHOOL_ADMIN");
const staff = () => requireTenantForAction("NON_TEACHING_STAFF");
const PAGES = ["/school-admin/staff", "/staff"];

export async function saveRoleProfileAction(_p: ActionResult<{ id: string; created: boolean } | undefined>, formData: FormData): Promise<ActionResult<{ id: string; created: boolean } | undefined>> {
  return performAction(
    async () => {
      const input = parseFormData(roleProfileSchema, formData);
      const { id: roleId, updatedStaff } = await saveRoleProfile(await admin(), input);
      return successResult(
        input.roleId ? `Role saved.${updatedStaff ? ` ${updatedStaff} staff now have exactly these permissions.` : ""}` : "Role added. Add staff to it from the Staff page.",
        { id: roleId, created: !input.roleId },
      );
    },
    // A new role opens on its own page; an edited one stays where it is.
    { revalidate: PAGES, redirectTo: (data) => (data?.created ? (`/school-admin/staff/roles/${data.id}` as Route) : null) },
  );
}

export async function setRoleArchivedAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const archived = formData.get("archived") === "true";
      await setRoleArchived(await admin(), id.parse(formData.get("roleId")), archived);
      return successResult(archived ? "Role archived." : "Role restored.");
    },
    { revalidate: PAGES },
  );
}

export async function setStaffGrantsAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const input = parseFormData(staffGrantsSchema, formData);
      await setStaffGrants(await admin(), input.staffId, input.grants);
      return successResult("Permissions saved. They apply from the staff member's next page.");
    },
    { revalidate: PAGES },
  );
}

export async function saveSubstitutionAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const input = parseFormData(substitutionSchema, formData);
      await saveSubstitution(await admin(), input);
      return successResult(input.substitutionId ? "Substitution updated." : "Substitute assigned. Their temporary access starts and ends with the dates.");
    },
    { revalidate: PAGES },
  );
}

export async function endSubstitutionAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      await endSubstitution(await admin(), parseFormData(endSubstitutionSchema, formData).substitutionId);
      return successResult("Substitution ended. The temporary access stopped now; the record is kept.");
    },
    { revalidate: PAGES },
  );
}

export async function markTripAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      await markTrip(await staff(), parseFormData(tripMarkSchema, formData));
      return successResult("Marked.");
    },
    { revalidate: ["/staff/my-route"] },
  );
}

export async function reportRouteIssueAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      await reportRouteIssue(await staff(), parseFormData(routeIssueSchema, formData));
      return successResult("Issue reported. The school office sees it on the route.");
    },
    { revalidate: ["/staff/my-route", "/school-admin/transport"] },
  );
}
