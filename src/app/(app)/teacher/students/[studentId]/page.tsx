import type { Route } from "next";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionButton } from "@/components/forms/action-button";
import { EmptyState } from "@/components/shared/empty-state";
import { NoSessionNotice } from "@/components/shared/no-session-notice";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { deleteRemarkAction } from "@/features/classwork/actions";
import { EditRemarkForm, RemarkForm } from "@/features/classwork/forms";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatPercent, humanize } from "@/lib/format";
import { requireTenant } from "@/server/auth/current-user";
import { getCurrentSession } from "@/server/academics/structure";
import { remarksForStudent } from "@/server/classwork/remarks";
import { orHidden } from "@/server/page-helpers";
import { getMyStudent, myTeachingOptions } from "@/server/people/teacher-self";

export const metadata: Metadata = { title: "Student" };

/**
 * One child, as their teacher sees them: attendance, and the staff record of
 * remarks about them.
 *
 * Both calls resolve the child through their current enrollment, so the
 * permission comes from where the school has placed them rather than from the
 * id in the URL. A child in a section this teacher does not teach answers
 * exactly as a child who does not exist.
 */
export default async function TeacherStudentPage(
  props: PageProps<"/teacher/students/[studentId]">,
) {
  const ctx = await requireTenant("TEACHER");
  const { studentId } = await props.params;

  if (!(await getCurrentSession(ctx))) {
    return <NoSessionNotice title="Student" back={{ href: "/teacher/classes", label: "My classes" }} />;
  }

  const detail = await orHidden(getMyStudent(ctx, studentId));
  // Null means "not enrolled in the current session" — nothing for a teacher
  // to act on, and not theirs to be told about.
  if (!detail) notFound();

  const [remarks, teaching] = await Promise.all([
    orHidden(remarksForStudent(ctx, studentId)),
    myTeachingOptions(ctx),
  ]);

  // The subjects this teacher teaches that section, so a remark can be filed
  // against the right one.
  const subjects = (teaching.find((option) => option.sectionId === detail.section.id)?.subjects ?? [])
    .map((subject) => ({ value: subject.id, label: subject.name }));

  const { student, counts } = detail;

  return (
    <>
      <PageHeader
        back={{ href: `/teacher/classes/${detail.section.id}` as Route, label: detail.section.label }}
        title={student.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={student.status} />
            {student.rollNumber ? `Roll ${student.rollNumber} · ` : ""}
            {student.admissionNumber}
          </span>
        }
        actions={
          <Button asChild variant="outline">
            <Link href={`/teacher/attendance?section=${detail.section.id}`}>Register</Link>
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Attendance"
          value={
            counts.total === 0
              ? "—"
              : formatPercent(counts.PRESENT + counts.LATE, counts.total)
          }
          hint={`since ${formatDate(detail.from)}`}
        />
        <StatCard label="Present" value={counts.PRESENT} hint={`of ${counts.total} marked`} />
        <StatCard label="Absent" value={counts.ABSENT} />
        <StatCard label="Late or excused" value={counts.LATE + counts.EXCUSED} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_1.2fr]">
        <Card>
          <CardHeader>
            <CardTitle>Add a remark</CardTitle>
            <CardDescription>
              Other teachers of this child can read what you write; only you can change it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RemarkForm studentId={student.id} subjects={subjects} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Remarks this session</CardTitle>
            <CardDescription>Newest first, from every teacher of this child.</CardDescription>
          </CardHeader>
          <CardContent>
            {remarks.length ? (
              <ul className="divide-y">
                {remarks.map((remark) => (
                  <li key={remark.id} className="flex flex-col gap-2 py-3">
                    {/* The bands first: they are the part a parent compares
                        across a year, and the note is context for them. */}
                    <div className="flex flex-wrap gap-1.5">
                      {remark.understanding ? (
                        <StatusBadge status={remark.understanding} label={`Understanding: ${humanize(remark.understanding)}`} />
                      ) : null}
                      {remark.homeworkHabit ? (
                        <StatusBadge status={remark.homeworkHabit} label={`Homework: ${humanize(remark.homeworkHabit)}`} />
                      ) : null}
                      {remark.participation ? (
                        <StatusBadge status={remark.participation} label={`Participation: ${humanize(remark.participation)}`} />
                      ) : null}
                    </div>
                    {remark.note ? (
                      <p className="text-sm whitespace-pre-line">{remark.note}</p>
                    ) : null}
                    <p className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
                      {remark.author}
                      {remark.subject ? ` · ${remark.subject}` : ""}
                      {` · ${formatDateTime(remark.createdAt)}`}
                    </p>
                    {remark.mine ? (
                      <div className="flex flex-wrap items-start gap-2">
                        {/* A disclosure rather than a dialog: the edit is the
                            same fields, and this keeps the page server-rendered. */}
                        <details className="min-w-0 flex-1">
                          <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-xs">
                            Edit
                          </summary>
                          <div className="pt-3">
                            <EditRemarkForm
                              remarkId={remark.id}
                              remark={{
                                understanding: remark.understanding,
                                homeworkHabit: remark.homeworkHabit,
                                participation: remark.participation,
                                note: remark.note,
                              }}
                            />
                          </div>
                        </details>
                        <ActionButton
                          action={deleteRemarkAction}
                          fields={{ remarkId: remark.id }}
                          variant="ghost"
                          confirm={{
                            title: "Delete this remark?",
                            description: "It is removed from this child's record for good.",
                            confirmLabel: "Delete",
                          }}
                        >
                          Delete
                        </ActionButton>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="Nothing written about this child yet">
                A remark is the staff record of how they are getting on — worth adding while it is
                fresh.
              </EmptyState>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
