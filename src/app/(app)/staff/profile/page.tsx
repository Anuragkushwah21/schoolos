import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/dates";
import { fullName, humanize } from "@/lib/format";
import { STAFF_PERMISSION_LABEL } from "@/lib/validation/operations";
import { requireTenant } from "@/server/auth/current-user";
import { requireStaffSelf } from "@/server/auth/staff-access";
import { orNotFound } from "@/server/page-helpers";

export const metadata: Metadata = { title: "My profile" };

/**
 * What the school holds about this staff member. Read-only: the record is the
 * school's, kept by the office. Their sign-in email and password are under
 * Account.
 */
export default async function StaffProfilePage() {
  const ctx = await requireTenant("NON_TEACHING_STAFF");
  const staff = await orNotFound(requireStaffSelf(ctx));
  const rows: Array<[string, React.ReactNode]> = [
    ["Employee ID", staff.employeeId],
    ["Designation", humanize(staff.role)],
    ["Job title", staff.designation ?? "—"],
    ["Department", staff.department ?? "—"],
    ["Mobile", staff.phone ?? "—"],
    ["Email", staff.email ?? "—"],
    ["Joined", staff.joiningDate ? formatDate(staff.joiningDate) : "—"],
    ["Status", <StatusBadge key="status" status={staff.status} />],
    ["School", ctx.schoolName],
  ];

  return (
    <>
      <PageHeader title={fullName(staff)} description="Your record at the school. Ask the office if anything here is wrong." />
      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[9rem_1fr] gap-x-4 gap-y-2 text-sm">
              {rows.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="min-w-0">{value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>What you can open</CardTitle>
            <CardDescription>Set by the School Admin.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            <ul className="flex list-disc flex-col gap-1 pl-5">
              <li>Your profile, school notices and meetings you are invited to</li>
              {staff.permissions.map((permission) => (
                <li key={permission}>{STAFF_PERMISSION_LABEL[permission].label} (read-only)</li>
              ))}
            </ul>
            <p className="text-muted-foreground mt-4">
              Change your password under{" "}
              <Link href="/account" className="underline">
                Account
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
