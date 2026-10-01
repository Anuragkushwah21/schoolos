import type { Metadata, Route } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SchoolLifeCards } from "@/features/dashboard/school-life";
import { ChildCard, ChildSwitcher } from "@/features/parent/child-nav";
import { AlertList, FocusList, TodaysUpdate } from "@/features/parent/today";
import { param } from "@/lib/search-params";
import { greetingKey } from "@/lib/greeting";
import { requireTenant } from "@/server/auth/current-user";
import { getT } from "@/server/i18n";
import { attendedShare, emptyCounts } from "@/server/attendance/service";
import { listMyChildren } from "@/server/parent/access";
import { getParentAlerts } from "@/server/parent/alerts";
import { familySupport } from "@/server/support/service";
import { StatusBadge } from "@/components/shared/status-badge";
import { getChildFocus, getChildToday } from "@/server/parent/child";
import { orNotFound } from "@/server/page-helpers";
import { today } from "@/lib/dates";

export const metadata: Metadata = { title: "Parent dashboard" };

/**
 * What a guardian sees on signing in.
 *
 * Built from the school's own operational records, so nothing here can disagree
 * with the register a teacher took. The children listed come from the
 * `ParentStudent` table and the `?child=` parameter can only ever select one of
 * them — an id belonging to somebody else's child resolves to a 404 in
 * `getChildToday`, which re-checks the link itself.
 */
export default async function ParentDashboardPage(props: PageProps<"/parent/dashboard">) {
  const ctx = await requireTenant("PARENT");
  const t = await getT();
  const search = await props.searchParams;

  const [{ parent, children }, alerts, family] = await Promise.all([
    listMyChildren(ctx),
    getParentAlerts(ctx),
    familySupport(ctx),
  ]);

  if (children.length === 0) {
    return (
      <>
        <PageHeader variant="hero" title={`${t(greetingKey(), { name: parent.firstName })} 👋`} />
        <EmptyState title={t("dashboard.parent.noChildren")}>
          The school office links a guardian to their children. Ask them to add yours, and
          everything about their day appears here.
        </EmptyState>
      </>
    );
  }

  const placed = children.filter((child) => child.sectionId !== null);

  // The child being looked at: the one asked for, if it is one of theirs, else
  // the first placed child. An unrelated id simply does not match.
  const requested = param(search.child);
  const selected = placed.find((child) => child.id === requested) ?? placed[0] ?? null;

  const attendance = await attendanceByChild(ctx, children.map((child) => child.id));

  const detail = selected
    ? await Promise.all([
        orNotFound(getChildToday(ctx, selected.id)),
        orNotFound(getChildFocus(ctx, selected.id)),
      ])
    : null;

  return (
    <>
      <PageHeader variant="hero"
        title={`${t(greetingKey(), { name: parent.firstName })} 👋`}
        description={
          children.length === 1
            ? "Your child's day at school, as their teachers recorded it."
            : `Your ${children.length} children's days at school, as their teachers recorded it.`
        }
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/parent/meetings">{t("nav.meetings")}</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/parent/notices">{t("nav.notices")}</Link>
            </Button>
          </>
        }
      />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>{t("dashboard.parent.needsAttention")}</CardTitle>
          <CardDescription>Taken from today&apos;s records, not a separate list.</CardDescription>
        </CardHeader>
        <CardContent>
          <AlertList alerts={alerts} />
        </CardContent>
      </Card>

      <SchoolLifeCards ctx={ctx} base="/parent" />

      <section className="mb-6">
        <h2 className="mb-3 font-semibold">
          {children.length === 1 ? t("dashboard.parent.myChild") : t("dashboard.parent.myChildren", { count: children.length })}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {children.map((child) => (
            <ChildCard
              key={child.id}
              child={child}
              attendanceShare={attendance.get(child.id)?.share ?? null}
              todayStatus={attendance.get(child.id)?.todayStatus ?? null}
            />
          ))}
        </div>
      </section>

      {selected && detail ? (
        <>
          <ChildSwitcher options={placed} activeId={selected.id} tab="" />

          <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
            <TodaysUpdate today={detail[0]} studentId={selected.id} />

            <div className="flex flex-col gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>{t("dashboard.parent.helpAtHome")}</CardTitle>
                  <CardDescription>
                    Drawn from what {selected.name.split(" ")[0]}&apos;s teachers recorded — each
                    line points at a lesson, a mark or a due date.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <FocusList items={detail[1].items} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
                  <CardTitle>{t("support.childSupport")}</CardTitle>
                  <Button asChild size="sm">
                    <Link href="/parent/concerns">+ {t("support.raiseConcern")}</Link>
                  </Button>
                </CardHeader>
                <CardContent>
                  {family.supports.filter((row) => row.status !== "RESOLVED").length ? (
                    <ul className="divide-y text-sm">
                      {family.supports
                        .filter((row) => row.status !== "RESOLVED")
                        .slice(0, 4)
                        .map((row) => (
                          <li key={row.id} className="flex flex-wrap items-center gap-2 py-2">
                            <span className="min-w-0 flex-1">
                              <span className="font-medium">
                                {row.child} — {row.subject ?? t("support.general")}
                              </span>
                              <span className="text-muted-foreground block text-xs">{t(`support.action.${row.action}`)}</span>
                            </span>
                            <StatusBadge status={row.status} />
                          </li>
                        ))}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground text-sm">{t("support.noChildSupport")}</p>
                  )}
                </CardContent>
              </Card>


              <Card>
                <CardHeader>
                  <CardTitle>{t("dashboard.parent.record", { name: selected.name.split(" ")[0] ?? selected.name })}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  {(
                    [
                      ["attendance", "Attendance"],
                      ["timetable", "Timetable"],
                      ["activity", "Class activity"],
                      ["homework", "Homework"],
                      ["results", "Tests & results"],
                      ["fees", "Fees & payments"],
                      ["remarks", "Teacher remarks"],
                      ["reports", "Reports"],
                    ] as const
                  ).map(([slug, label]) => (
                    <Button key={slug} asChild size="sm" variant="outline">
                      <Link href={`/parent/children/${selected.id}/${slug}` as Route}>{label}</Link>
                    </Button>
                  ))}
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      ) : (
children.every((child) => child.current === false) ? (
        // No active children: the guardian may still sign in, and sees who
        // their children were, but the school has no current day to report.
        <EmptyState title={t("lifecycle.noActiveChildren")}>{t("lifecycle.noActiveChildrenHint")}</EmptyState>
      ) : (
        <EmptyState title="Not placed in a class this session">
          The school has not put {children.length === 1 ? "your child" : "any of your children"} in a
          section for the current academic year yet. Their day appears here once it does.
        </EmptyState>
      )
      )}
    </>
  );
}

/**
 * Attendance headline per child, in two queries rather than two per child.
 *
 * Scoped by the ids the link table already produced, so this cannot widen to a
 * child who is not this guardian's.
 */
async function attendanceByChild(
  ctx: Awaited<ReturnType<typeof requireTenant>>,
  studentIds: string[],
): Promise<Map<string, { share: number | null; todayStatus: string | null }>> {
  if (studentIds.length === 0) return new Map();

  const [totals, todayMarks] = await Promise.all([
    ctx.db.studentAttendance.groupBy({
      by: ["studentId", "status"],
      where: { studentId: { in: studentIds }, academicSession: { isCurrent: true } },
      _count: { _all: true },
    }),
    ctx.db.studentAttendance.findMany({
      where: { studentId: { in: studentIds }, date: today() },
      select: { studentId: true, status: true },
    }),
  ]);

  const counts = new Map<string, ReturnType<typeof emptyCounts>>();
  for (const row of totals) {
    const entry = counts.get(row.studentId) ?? emptyCounts();
    entry[row.status] += row._count._all;
    entry.total += row._count._all;
    counts.set(row.studentId, entry);
  }

  const todayByChild = new Map(todayMarks.map((row) => [row.studentId, row.status as string]));

  return new Map(
    studentIds.map((id) => [
      id,
      {
        share: counts.has(id) ? attendedShare(counts.get(id)!) : null,
        todayStatus: todayByChild.get(id) ?? null,
      },
    ]),
  );
}
