import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireTenant } from "@/server/auth/current-user";
import { findStudentSelf } from "@/server/student/access";

export const metadata: Metadata = { title: "My profile" };

/**
 * What the school holds about this student.
 *
 * Read-only. The admission number, the placement and the status are the school's
 * record of them — a student editing any of it would be editing their own
 * academic record. Their sign-in email and password live under Account, which
 * every role shares.
 */
export default async function StudentProfilePage() {
  const ctx = await requireTenant("STUDENT");
  const { student, placement } = await findStudentSelf(ctx);

  return (
    <>
      <PageHeader
        title={student.name}
        description={ctx.schoolName}
        actions={
          <Button asChild variant="outline">
            <Link href="/account">Account settings</Link>
          </Button>
        }
      />

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>My record</CardTitle>
          <CardDescription>
            Held by the school office. Ask them to correct anything that is wrong.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <Detail label="Name" value={student.name} />
            <Detail label="Admission number" value={student.admissionNumber} />
            <Detail label="Sign-in email" value={ctx.user.email} />
            <Detail label="Status" value={<StatusBadge status={student.status} />} />
            <Detail label="Class" value={placement?.sectionLabel ?? "Not placed this session"} />
            <Detail label="Roll number" value={placement?.rollNumber ?? "—"} />
            <Detail label="Session" value={placement?.sessionName ?? "—"} />
          </dl>
        </CardContent>
      </Card>
    </>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}
