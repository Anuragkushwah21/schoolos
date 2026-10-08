import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChildSwitcher, ChildTabs } from "@/features/parent/child-nav";
import { formatDate } from "@/lib/dates";
import { humanize } from "@/lib/format";
import { requireTenant } from "@/server/auth/current-user";
import { orNotFound } from "@/server/page-helpers";
import { listMyChildren } from "@/server/parent/access";
import { getChildProfile } from "@/server/parent/child";

export const metadata: Metadata = { title: "Profile" };

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex justify-between gap-4 py-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value || "—"}</dd>
    </div>
  );
}

/**
 * The child's details as the school holds them, read-only. To change
 * anything, the family contacts the school office (their own contact details
 * are on My account).
 */
export default async function ChildProfilePage(props: PageProps<"/parent/children/[studentId]/profile">) {
  const ctx = await requireTenant("PARENT");
  const { studentId } = await props.params;
  const [{ children }, data] = await Promise.all([listMyChildren(ctx), orNotFound(getChildProfile(ctx, studentId))]);
  const { child, student } = data;
  return (
    <>
      <PageHeader back={{ href: "/parent/dashboard", label: "Dashboard" }} title={`${child.student.name} — profile`} description={`${child.placement.sectionLabel} · ${child.placement.sessionName}`} />
      <ChildSwitcher options={children.filter((sibling) => sibling.sectionId !== null)} activeId={studentId} tab="profile" />
      <ChildTabs studentId={studentId} active="profile" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y text-sm">
              <Row label="Admission number" value={student.admissionNumber} />
              <Row label="Date of birth" value={student.dateOfBirth ? formatDate(student.dateOfBirth) : null} />
              <Row label="Gender" value={student.gender ? humanize(student.gender) : null} />
              <Row label="Blood group" value={student.bloodGroup} />
              <Row label="Admitted on" value={student.admissionDate ? formatDate(student.admissionDate) : null} />
              <Row label="Address" value={[student.addressLine, student.city].filter(Boolean).join(", ")} />
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Class</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y text-sm">
              <Row label="Class" value={child.placement.sectionLabel} />
              <Row label="Roll number" value={child.placement.rollNumber} />
              <Row label="Class teacher" value={data.classTeacher} />
              {data.subjectTeachers.map((row) => (
                <Row key={`${row.subject}-${row.teacher}`} label={row.subject} value={row.teacher} />
              ))}
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Guardians on file</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y text-sm">
              {student.guardians.map((guardian) => (
                <Row key={guardian.name} label={`${humanize(guardian.relationship)}${guardian.primary ? " (primary)" : ""}`} value={guardian.name} />
              ))}
            </dl>
            <p className="text-muted-foreground mt-3 text-xs">Something wrong? Contact the school office to correct it.</p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
