import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/dates";
import { pluralize } from "@/lib/format";
import { NoSessionNotice } from "@/components/shared/no-session-notice";
import { enumParam, param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { getCurrentSession } from "@/server/academics/structure";
import { HOMEWORK_STATUSES, listMyHomework } from "@/server/classwork/homework";
import { myTeachingOptions } from "@/server/people/teacher-self";

export const metadata: Metadata = { title: "Homework" };

/**
 * The work this teacher has set.
 *
 * Authorship, not section access: a class teacher sees their colleagues'
 * homework on the dashboard's "due soon" list, but this is the list they can
 * edit, so it only ever holds their own.
 */
export default async function TeacherHomeworkPage(props: PageProps<"/teacher/homework">) {
  const ctx = await requireTenant("TEACHER");
  if (!(await getCurrentSession(ctx))) return <NoSessionNotice title="Homework" />;

  const search = await props.searchParams;

  const sectionId = param(search.section);
  const subjectId = param(search.subject);
  const status = enumParam(search.status, HOMEWORK_STATUSES);

  const [teaching, homework] = await Promise.all([
    myTeachingOptions(ctx),
    listMyHomework(ctx, { sectionId, subjectId, status }),
  ]);

  // One entry per subject the teacher teaches anywhere, for the filter.
  const subjects = [
    ...new Map(
      teaching.flatMap((option) => option.subjects).map((subject) => [subject.id, subject]),
    ).values(),
  ].sort((a, b) => a.name.localeCompare(b.name));

  const overdue = homework.filter((item) => item.overdue).length;

  return (
    <>
      <PageHeader
        title="Homework"
        description={
          overdue
            ? `${pluralize(overdue, "assignment")} past its due date.`
            : "Work you have set for your classes."
        }
        actions={
          <Button asChild>
            <Link href="/teacher/homework/new">Set homework</Link>
          </Button>
        }
      />

      <FilterBar
        action="/teacher/homework"
        selects={[
          {
            name: "section",
            label: "Class",
            defaultValue: sectionId,
            allLabel: "All classes",
            options: teaching.map((option) => ({
              value: option.sectionId,
              label: option.label,
            })),
          },
          {
            name: "subject",
            label: "Subject",
            defaultValue: subjectId,
            allLabel: "All subjects",
            options: subjects.map((subject) => ({ value: subject.id, label: subject.name })),
          },
          {
            name: "status",
            label: "Status",
            defaultValue: status,
            allLabel: "Any status",
            options: [
              { value: "PUBLISHED", label: "Set for the class" },
              { value: "DRAFT", label: "Draft" },
            ],
          },
        ]}
      />

      {homework.length ? (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Work</TableHead>
                <TableHead>Class</TableHead>
                <TableHead className="w-28">Status</TableHead>
                <TableHead className="hidden w-28 md:table-cell">Set on</TableHead>
                <TableHead className="w-32">Due</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {homework.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="max-w-md whitespace-normal">
                    <Link
                      href={`/teacher/homework/${item.id}`}
                      className="font-medium hover:underline"
                    >
                      {item.title}
                    </Link>
                    <p className="text-muted-foreground text-xs">{item.subject}</p>
                  </TableCell>
                  <TableCell>{item.section}</TableCell>
                  <TableCell>
                    <StatusBadge status={item.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden tabular-nums md:table-cell">
                    {formatDate(item.assignedOn)}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {formatDate(item.dueOn)}
                    {item.overdue ? (
                      <span className="block text-xs" style={{ color: "var(--viz-warning)" }}>
                        overdue
                      </span>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState
          title={sectionId || subjectId || status ? "Nothing matches those filters" : "No homework set yet"}
          action={
            <Button asChild variant="outline">
              <Link href="/teacher/homework/new">Set homework</Link>
            </Button>
          }
        >
          Work you set here appears to the class, and to their parents, as soon as it is published.
        </EmptyState>
      )}
    </>
  );
}
