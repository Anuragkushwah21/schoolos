import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { LifecyclePanel } from "@/features/people/lifecycle-panel";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StaffForm, StaffLoginForm } from "@/features/operations/forms";
import { ActivationEmailNote, ResetPortalPasswordForm } from "@/features/school/people-forms";
import { activationEmailStatuses } from "@/server/auth/account-links";
import { formatDateTime, toDateInput } from "@/lib/dates";
import { fullName } from "@/lib/format";
import { PersonPhoto } from "@/components/shared/person-photo";
import { requireTenant } from "@/server/auth/current-user";
import { photoUrlFor } from "@/server/people/photos";
import { getStaff } from "@/server/operations/staff";
import { orNotFound } from "@/server/page-helpers";

export const metadata: Metadata = { title: "Staff member" };

export default async function StaffMemberPage(props: PageProps<"/school-admin/staff/[staffId]">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const { staffId } = await props.params;
  const staff = await orNotFound(getStaff(ctx, staffId));
  const [photoUrl, invites] = await Promise.all([
    photoUrlFor(ctx, { type: "STAFF", id: staff.id }),
    activationEmailStatuses(ctx, [staff.user?.id]),
  ]);

  return (
    <>
      <PageHeader back={{ href: "/school-admin/staff", label: "Staff" }} title={fullName(staff)} />
      <div className="mb-6">
        <PersonPhoto name={fullName(staff)} photoUrl={photoUrl} who="The staff member" />
      </div>
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
                    label={!staff.user.isActive ? "Disabled" : staff.user.activatedAt ? "Can sign in" : "Pending activation"}
                    tone={!staff.user.isActive ? "neutral" : staff.user.activatedAt ? "positive" : "warning"}
                  />
                </div>
                {staff.user.isActive && !staff.user.activatedAt ? <ActivationEmailNote invite={invites.get(staff.user.id)} /> : null}
                <p className="text-muted-foreground">
                  {staff.user.lastLoginAt ? `Last signed in ${formatDateTime(staff.user.lastLoginAt)}.` : "Has not signed in yet."}
                  {staff.user.isActive ? "" : " Set the status back to Active to let them sign in again."}
                </p>
                <ResetPortalPasswordForm userId={staff.user.id} pending={!staff.user.activatedAt} />
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
