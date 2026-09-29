import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { LifecyclePanel } from "@/features/people/lifecycle-panel";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StaffForm, StaffLoginForm } from "@/features/operations/forms";
import { ResetPortalPasswordForm } from "@/features/school/people-forms";
import { formatDateTime, toDateInput } from "@/lib/dates";
import { fullName } from "@/lib/format";
import { requireTenant } from "@/server/auth/current-user";
import { getStaff } from "@/server/operations/staff";
import { orNotFound } from "@/server/page-helpers";

export const metadata: Metadata = { title: "Staff member" };

export default async function StaffMemberPage(props: PageProps<"/school-admin/staff/[staffId]">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const { staffId } = await props.params;
  const staff = await orNotFound(getStaff(ctx, staffId));
  return (
    <>
      <PageHeader back={{ href: "/school-admin/staff", label: "Staff" }} title={fullName(staff)} />
      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <StaffForm staff={{ ...staff, joiningDate: staff.joiningDate ? toDateInput(staff.joiningDate) : "" }} />
        <div className="flex flex-col gap-6">
        <LifecyclePanel ctx={ctx} person="STAFF" personId={staff.id} />
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Login</CardTitle>
            <CardDescription>
              Staff sign in at the usual login page and land in the staff portal — never the School Admin screens.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            {staff.user ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{staff.user.email}</span>
                  <StatusBadge
                    status={staff.user.isActive ? "ACTIVE" : "INACTIVE"}
                    label={staff.user.isActive ? "Can sign in" : "Disabled"}
                    tone={staff.user.isActive ? "positive" : "neutral"}
                  />
                </div>
                <p className="text-muted-foreground">
                  {staff.user.lastLoginAt ? `Last signed in ${formatDateTime(staff.user.lastLoginAt)}.` : "Has not signed in yet."}
                  {staff.user.isActive ? "" : " Set the status back to Active to let them sign in again."}
                </p>
                <ResetPortalPasswordForm userId={staff.user.id} />
              </>
            ) : !["ACTIVE", "ON_LEAVE"].includes(staff.status) ? (
              <p className="text-muted-foreground">Inactive staff cannot be given a login.</p>
            ) : (
              <StaffLoginForm staffId={staff.id} defaultEmail={staff.email} />
            )}
          </CardContent>
        </Card>
        </div>
      </div>
    </>
  );
}
