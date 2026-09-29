import type { Metadata } from "next";

import { ActionForm } from "@/components/forms/action-form";
import { SelectField, SubmitButton } from "@/components/forms/fields";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { bulkStudentsAction } from "@/features/school/bulk-student-actions";
import { fullName, humanize } from "@/lib/format";
import { param } from "@/lib/search-params";
import { STUDENT_STATUSES } from "@/lib/validation/school";
import { requireTenant } from "@/server/auth/current-user";
import { sectionLabel } from "@/server/academics/structure";

export const metadata: Metadata = { title: "Bulk student actions" };

/**
 * Pick a session and section, tick students, then promote them into a later
 * session, move them to another section of the same session, or change their
 * status. Everything is re-checked on the server and applied all-or-nothing.
 */
export default async function BulkStudentsPage(props: PageProps<"/school-admin/students/bulk">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const search = await props.searchParams;

  const sessions = await ctx.db.academicSession.findMany({
    orderBy: { startDate: "desc" },
    select: { id: true, name: true, isCurrent: true, startDate: true },
  });
  const session = sessions.find((row) => row.id === param(search.session)) ?? sessions.find((row) => row.isCurrent) ?? sessions[0];
  if (!session) return <EmptyState title="Create an academic session first" />;

  const allSections = await ctx.db.section.findMany({
    select: {
      id: true,
      name: true,
      academicSessionId: true,
      class: { select: { name: true, level: true } },
      stream: { select: { name: true } },
    },
  });
  const sorted = allSections.sort((a, b) => a.class.level - b.class.level || a.name.localeCompare(b.name));
  const sessionName = new Map(sessions.map((row) => [row.id, row.name]));
  const here = sorted.filter((section) => section.academicSessionId === session.id);
  const section = here.find((row) => row.id === param(search.section)) ?? null;
  const later = sorted.filter((row) => {
    const start = sessions.find((s) => s.id === row.academicSessionId)?.startDate;
    return start !== undefined && start > session.startDate;
  });

  const enrollments = section
    ? await ctx.db.studentEnrollment.findMany({
        where: { sectionId: section.id, academicSessionId: session.id },
        select: {
          status: true,
          rollNumber: true,
          student: { select: { id: true, firstName: true, lastName: true, admissionNumber: true, status: true } },
        },
      })
    : [];
  const rollOrder = (roll: string | null) => (roll && /^\d+$/.test(roll) ? Number(roll) : Number.MAX_SAFE_INTEGER);
  enrollments.sort((a, b) => rollOrder(a.rollNumber) - rollOrder(b.rollNumber) || a.student.firstName.localeCompare(b.student.firstName));

  return (
    <>
      <PageHeader
        back={{ href: "/school-admin/students", label: "Students" }}
        title="Bulk student actions"
        description="Promote a class to the next session, move students between sections, or change status."
      />
      <FilterBar
        action="/school-admin/students/bulk"
        selects={[
          { name: "session", label: "Session", defaultValue: session.id, options: sessions.map((row) => ({ value: row.id, label: row.name })) },
          { name: "section", label: "Section", defaultValue: section?.id, allLabel: "Choose a section", options: here.map((row) => ({ value: row.id, label: sectionLabel(row) })) },
        ]}
      />

      {!section ? (
        <EmptyState title="Choose a section">Pick the session and section whose students you want to work on.</EmptyState>
      ) : enrollments.length === 0 ? (
        <EmptyState title="No students in this section" />
      ) : (
        <ActionForm action={bulkStudentsAction}>
          <input type="hidden" name="fromSessionId" value={session.id} />
          <Card>
            <CardHeader>
              <CardTitle>
                {sectionLabel(section)} · {session.name}
              </CardTitle>
              <CardDescription>{enrollments.length} students. Untick anyone who should be left out.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {enrollments.map((row) => (
                  <li key={row.student.id}>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="studentIds" value={row.student.id} defaultChecked className="accent-primary size-4" />
                      <span>
                        {row.rollNumber ? `${row.rollNumber}. ` : ""}
                        {fullName(row.student)}
                        <span className="text-muted-foreground text-xs">
                          {" "}
                          · {row.student.admissionNumber}
                          {row.student.status !== "ACTIVE" ? ` · ${humanize(row.student.status)}` : ""}
                          {row.status !== "ACTIVE" ? ` · ${humanize(row.status)}` : ""}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Promote</CardTitle>
                <CardDescription>Into a section of a later session. This year&apos;s records stay untouched.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {later.length ? (
                  <>
                    <SelectField
                      name="promoteToSectionId"
                      label="Promote to"
                      options={later.map((row) => ({ value: row.id, label: `${sessionName.get(row.academicSessionId)} · ${sectionLabel(row)}` }))}
                      placeholder="Choose a section"
                    />
                    <div>
                      <SubmitButton name="operation" value="promote" pendingLabel="Promoting…">
                        Promote selected
                      </SubmitButton>
                    </div>
                  </>
                ) : (
                  <p className="text-muted-foreground text-sm">Create the next academic session and its sections under Academics first.</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Change section</CardTitle>
                <CardDescription>Within {session.name}. Roll numbers are cleared to be reassigned.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <SelectField
                  name="moveToSectionId"
                  label="Move to"
                  options={here.filter((row) => row.id !== section.id).map((row) => ({ value: row.id, label: sectionLabel(row) }))}
                  placeholder="Choose a section"
                />
                <div>
                  <SubmitButton name="operation" value="move" variant="outline" pendingLabel="Moving…">
                    Move selected
                  </SubmitButton>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Change status</CardTitle>
                <CardDescription>Students who leave lose their portal login.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <SelectField
                  name="status"
                  label="New status"
                  options={STUDENT_STATUSES.map((value) => ({ value, label: humanize(value) }))}
                  placeholder="Choose a status"
                />
                <div>
                  <SubmitButton name="operation" value="status" variant="outline" pendingLabel="Updating…">
                    Update selected
                  </SubmitButton>
                </div>
              </CardContent>
            </Card>
          </div>
        </ActionForm>
      )}
    </>
  );
}
