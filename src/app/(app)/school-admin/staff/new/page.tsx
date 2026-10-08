import type { Metadata, Route } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { StaffWizard } from "@/features/staff/staff-wizard";
import { param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { schoolEntitlements } from "@/server/platform/entitlements";
import { listRoleProfiles } from "@/server/staff/roles";

export const metadata: Metadata = { title: "Add staff" };

/** Teaching-side staff roles kept as staff records (teachers have their own form). */
const TEACHING_ROLES = new Set(["COORDINATOR"]);

export default async function NewStaffPage(props: PageProps<"/school-admin/staff/new">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const search = await props.searchParams;
  // Only designations this campus's plan includes can be chosen (the server refuses the rest too).
  const { roles: allowed } = await schoolEntitlements(ctx.schoolId);
  const roles = (await listRoleProfiles(ctx)).filter((role) => (allowed as string[]).includes(role.baseRole)).map((role) => ({
    id: role.id,
    name: role.name,
    baseRole: role.baseRole,
    defaultGrants: role.defaultGrants,
    category: TEACHING_ROLES.has(role.baseRole) ? ("TEACHING" as const) : ("NON_TEACHING" as const),
  }));
  const asked = roles.find((role) => role.id === param(search.role) || role.baseRole === param(search.role));
  const category = asked?.category ?? (param(search.category) === "TEACHING" ? "TEACHING" : "NON_TEACHING");
  return (
    <>
      <PageHeader
        back={{ href: "/school-admin/staff" as Route, label: "Staff" }}
        title="Add staff"
        description="Four short steps: who they are, what they may do, their documents, and a last look before creating the profile."
      />
      <StaffWizard roles={roles} initialCategory={category} initialRoleId={asked?.id} />
    </>
  );
}
