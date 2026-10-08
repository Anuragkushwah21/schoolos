import type { Metadata, Route } from "next";
import Link from "next/link";

import { ActionButton } from "@/components/forms/action-button";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { ViewTabs } from "@/components/shared/view-tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { clearSubstituteAction } from "@/features/staff/actions";
import { CoverForm } from "@/features/staff/forms";
import { addDays, formatDate, formatDayShort, formatMinutes, parseDateInput, today, toDateInput } from "@/lib/dates";
import { humanize } from "@/lib/format";
import { param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { schoolClosureOn } from "@/server/calendar/holidays";
import { COVER_AHEAD_DAYS, COVER_BACK_DAYS, getCoverPlan } from "@/server/classwork/substitutes";
import { listSubstitutions } from "@/server/staff/substitutions";

export const metadata: Metadata = { title: "Cover" };

/**
 * Substitute planning for one day. Absences come from the staff register and
 * approved leave; each of an absent teacher's periods lists only the teachers
 * free at that time.
 */
export default async function SubstitutesPage(props: PageProps<"/school-admin/substitutes">) {
  const ctx = await requireTenant("SCHOOL_ADMIN", "PRINCIPAL");
  const search = await props.searchParams;
  const now = today();
  const date = parseDateInput(param(search.date)) ?? now;
  const subStatus = (["ACTIVE", "SCHEDULED", "EXPIRED", "ENDED"] as const).find((value) => value === param(search.substitutions));
  const [plan, closure, staffSubs] = await Promise.all([getCoverPlan(ctx, date), schoolClosureOn(ctx, date), listSubstitutions(ctx, { status: subStatus })]);
  const key = toDateInput(date);

  return (
    <>
      <PageHeader
        back={{ href: "/school-admin/leave", label: "Leave" }}
        title="Cover & substitutes"
        description={`Teachers' periods on ${formatDayShort(date)}, and non-teaching staff substitutions.`}
      />
      <FilterBar
        action="/school-admin/substitutes"
        dates={[{ name: "date", label: "Date", defaultValue: key, max: toDateInput(addDays(now, COVER_AHEAD_DAYS)) }]}
      />
      {closure ? (
        <EmptyState title={closure.label}>No classes run that day, so there is nothing to cover.</EmptyState>
      ) : !plan.inWindow ? (
        <EmptyState title="Outside the cover window">
          Cover can be arranged from {COVER_BACK_DAYS} days back to {COVER_AHEAD_DAYS} days ahead.
        </EmptyState>
      ) : plan.absentees.length ? (
        <div className="flex flex-col gap-6">
          {plan.absentees.map((absentee) => (
            <Card key={absentee.teacherId}>
              <CardHeader>
                <CardTitle>{absentee.name}</CardTitle>
                <CardDescription>{absentee.reason}</CardDescription>
              </CardHeader>
              <CardContent>
                {absentee.periods.length ? (
                  <ul className="divide-y">
                    {absentee.periods.map((period) => (
                      <li key={period.slotId} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                        <span className="w-32 shrink-0 tabular-nums">
                          {formatMinutes(period.startMinute)}–{formatMinutes(period.endMinute)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="font-medium">{period.subject}</span> · {period.section}
                          {period.room ? ` · ${period.room}` : ""}
                        </span>
                        {period.cover ? (
                          <span className="flex items-center gap-2">
                            <span>Covered by {period.cover.name}</span>
                            <ActionButton
                              action={clearSubstituteAction}
                              fields={{ classSessionId: period.cover.classSessionId }}
                              variant="ghost"
                              size="xs"
                              confirm={{ title: "Remove this cover?", description: "The period goes back to the absent teacher.", confirmLabel: "Remove" }}
                            >
                              Remove
                            </ActionButton>
                          </span>
                        ) : (
                          <CoverForm slotId={period.slotId} date={key} candidates={period.candidates} />
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground text-sm">No periods on the timetable that day.</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState title="Everyone is in">
          Nobody is marked absent or on approved leave that day. Mark the staff register or approve leave first.
        </EmptyState>
      )}

      {/* Non-teaching staff: date-range substitutions with temporary access, arranged on each person's page. */}
      <section aria-labelledby="staff-subs" className="mt-10">
        <h2 id="staff-subs" className="mb-1 text-base font-semibold">
          Staff substitutions
        </h2>
        <p className="text-muted-foreground mb-3 text-sm">Arrange one from a staff member&apos;s page → Substitutes. Access starts and expires with the dates; history is kept.</p>
        <ViewTabs
          label="Substitution status"
          tabs={[
            { href: "/school-admin/substitutes#staff-subs" as Route, label: "All", active: !subStatus },
            ...(["ACTIVE", "SCHEDULED", "EXPIRED", "ENDED"] as const).map((value) => ({ href: `/school-admin/substitutes?substitutions=${value}#staff-subs` as Route, label: humanize(value), active: subStatus === value })),
          ]}
        />
        {staffSubs.length ? (
          <ul className="divide-y rounded-xl border">
            {staffSubs.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                <span className="min-w-0 flex-1">
                  <Link href={`/school-admin/staff/${row.substitute.id}?tab=substitutes` as Route} className="font-medium hover:underline">
                    {row.substitute.name}
                  </Link>{" "}
                  covers for{" "}
                  <Link href={`/school-admin/staff/${row.original.id}?tab=substitutes` as Route} className="font-medium hover:underline">
                    {row.original.name}
                  </Link>
                  <span className="text-muted-foreground block text-xs">
                    {formatDate(row.startDate)} – {formatDate(row.endDate)} · {row.reason}
                    {row.createdBy ? ` · set by ${row.createdBy}` : ""}
                  </span>
                </span>
                <StatusBadge status={row.status} tone={row.status === "ACTIVE" ? "positive" : row.status === "SCHEDULED" ? "info" : row.status === "ENDED" ? "warning" : "neutral"} label={humanize(row.status)} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No staff substitutions here" />
        )}
      </section>
    </>
  );
}
