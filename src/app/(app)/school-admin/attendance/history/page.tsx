import { HistoryIcon } from "lucide-react";
import type { Metadata } from "next";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { addDays, formatDate, formatDateTime, parseDateInput, toDateInput, today } from "@/lib/dates";
import { param } from "@/lib/search-params";
import { registerHistory, workCoverHistory } from "@/server/attendance/cover";
import { getCurrentSession, sectionOptions } from "@/server/academics/structure";
import { requireTenant } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Attendance history" };

/** Who was away, who covered, and who took each register — day by day. */
export default async function AttendanceHistoryPage(props: PageProps<"/school-admin/attendance/history">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const search = await props.searchParams;
  const to = parseDateInput(param(search.to)) ?? today();
  const from = parseDateInput(param(search.from)) ?? addDays(to, -13);
  const sectionId = param(search.section);
  const session = await getCurrentSession(ctx);
  const [rows, staff, sections] = await Promise.all([
    registerHistory(ctx, { from, to, sectionId }),
    workCoverHistory(ctx, { from, to }),
    session ? sectionOptions(ctx, session.id) : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHeader
        icon={HistoryIcon}
        tone="blue"
        back={{ href: "/school-admin/attendance/cover", label: "Who covers today" }}
        title="Attendance history"
        description="Who was away, who covered, and who took each class's attendance."
      />
      <FilterBar
        action="/school-admin/attendance/history"
        selects={[{ name: "section", label: "Class", defaultValue: sectionId, allLabel: "All classes", options: sections }]}
        dates={[
          { name: "from", label: "From", defaultValue: toDateInput(from) },
          { name: "to", label: "To", defaultValue: toDateInput(to), max: toDateInput(today()) },
        ]}
      />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Class registers</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[46rem] text-sm">
                <thead className="text-muted-foreground text-left">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Date</th>
                    <th className="py-2 pr-3 font-medium">Class</th>
                    <th className="py-2 pr-3 font-medium">Class teacher</th>
                    <th className="py-2 pr-3 font-medium">Covered by</th>
                    <th className="py-2 pr-3 font-medium">Taken by</th>
                    <th className="py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.key} className="border-t align-top">
                      <td className="py-2 pr-3 tabular-nums">{formatDate(row.date)}</td>
                      <td className="py-2 pr-3 font-medium">{row.section}</td>
                      <td className="py-2 pr-3">
                        {row.classTeacher ?? "—"}
                        {row.classTeacherAway ? <span className="text-danger-strong block text-xs">{row.classTeacherAway}</span> : null}
                      </td>
                      <td className="py-2 pr-3">
                        {row.cover ? row.cover.teacher : "—"}
                        {row.cover?.assignedBy ? <span className="text-muted-foreground block text-xs">assigned by {row.cover.assignedBy}</span> : null}
                      </td>
                      <td className="py-2 pr-3">
                        {row.takenBy ?? (row.automatically ? "Submitted automatically" : "—")}
                        {row.submittedAt ? <span className="text-muted-foreground block text-xs">{formatDateTime(row.submittedAt)}</span> : null}
                      </td>
                      <td className="py-2">
                        <StatusBadge status={row.status} tone={row.status === "Submitted" ? "positive" : row.status === "Draft" ? "info" : "warning"} label={row.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="Nothing recorded for these dates" />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Staff work cover</CardTitle>
        </CardHeader>
        <CardContent>
          {staff.length ? (
            <ul className="divide-y text-sm">
              {staff.map((row) => (
                <li key={row.id} className="py-2.5">
                  <span className="font-medium">{formatDate(row.date)}</span> · {row.cover} covered {row.absent}
                  <span className="text-muted-foreground block text-xs">
                    {row.duties}
                    {row.assignedBy ? ` · assigned by ${row.assignedBy}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">No staff cover in these dates.</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
