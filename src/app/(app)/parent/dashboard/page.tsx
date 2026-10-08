import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import {
  CalendarOffIcon,
  ClipboardCheckIcon,
  HandshakeIcon,
  MegaphoneIcon,
  MessageCircleIcon,
  NotebookPenIcon,
  TrophyIcon,
  WalletIcon,
} from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { QuickActions } from "@/components/shared/quick-actions";
import { readStudentFees } from "@/server/finance/fees";
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
import { hasModule, schoolModules } from "@/server/platform/modules";
import { withinModules } from "@/lib/school-modules";

export const metadata: Metadata = { title: "Parent dashboard" };

/**
 * What a guardian sees on signing in, in the order a parent asks: how are my
 * children today (and is anything due), does anything need me, and where do I
 * go for the rest — as big labelled buttons, not menus. Then one child's day
 * in detail, and the school's notices, events and meetings in one short card.
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

  const [attendance, fees] = await Promise.all([
    attendanceByChild(ctx, children.map((child) => child.id)),
    // What each current child still owes, read through the same guarded
    // service the Fees page uses — never another family's.
    // Only when the school's plan has fees.
    (await hasModule(ctx, "FINANCE")) ? Promise.all(
      children
        .filter((child) => child.current !== false)
        .map(async (child) => [child.id, (await readStudentFees(ctx, child.id)).summary.pendingMinor] as const),
    ).then((rows) => new Map(rows)) : Promise.resolve(new Map<string, number>()),
  ]);

  const detail = selected
    ? await Promise.all([
        orNotFound(getChildToday(ctx, selected.id)),
        orNotFound(getChildFocus(ctx, selected.id)),
      ])
    : null;

  const openSupport = family.supports.filter((row) => row.status !== "RESOLVED");

  return (
    <>
      <PageHeader
        variant="hero"
        title={`${t(greetingKey(), { name: parent.firstName })} 👋`}
        description={children.length === 1 ? "Here is how your child is doing at school." : "Here is how your children are doing at school."}
      />

      {/* 1. Each child at a glance: today, attendance, fees. */}
      <section aria-labelledby="my-children" className="mb-6">
        <h2 id="my-children" className="mb-3 text-lg font-bold">
          {children.length === 1 ? t("dashboard.parent.myChild") : t("dashboard.parent.myChildren", { count: children.length })}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {children.map((child) => (
            <ChildCard
              key={child.id}
              child={child}
              attendanceShare={attendance.get(child.id)?.share ?? null}
              todayStatus={attendance.get(child.id)?.todayStatus ?? null}
              feesDueMinor={fees.get(child.id) ?? null}
            />
          ))}
        </div>
      </section>

      {/* 2. Only what needs the parent; a plain "all good" otherwise. */}
      <section aria-labelledby="attention" className="mb-6">
        <h2 id="attention" className="mb-3 text-lg font-bold">
          {t("dashboard.parent.needsAttention")}
        </h2>
        {alerts.length ? (
          <Card>
            <CardContent>
              <AlertList alerts={alerts} />
            </CardContent>
          </Card>
        ) : (
          <p className="bg-success-soft text-success-strong border-success/25 rounded-2xl border px-4 py-3 text-sm font-medium">Nothing needs you today. All good!</p>
        )}
      </section>

      {/* 3. Big, labelled buttons for everything a parent comes to do. */}
      <QuickActions
        compact
        title="What do you want to see?"
        actions={withinModules([
          { href: "/parent/attendance", label: t("nav.attendance"), icon: ClipboardCheckIcon, tone: "green" },
          { href: "/parent/homework", label: t("nav.homework"), icon: NotebookPenIcon, tone: "purple" },
          { href: "/parent/results", label: t("nav.results"), icon: TrophyIcon, tone: "orange" },
          { href: "/parent/fees", label: t("nav.fees"), icon: WalletIcon, tone: "green" },
          { href: "/parent/notices", label: t("nav.notices"), icon: MegaphoneIcon, tone: "amber" },
          { href: "/parent/leave", label: "Ask for leave", icon: CalendarOffIcon, tone: "blue" },
          { href: "/parent/concerns", label: "Talk to teacher", icon: MessageCircleIcon, tone: "cyan" },
          { href: "/parent/meetings", label: t("nav.meetings"), icon: HandshakeIcon, tone: "red" },
        ], await schoolModules(ctx.schoolId))}
      />

      {selected && detail ? (
        <>
          {/* 4. One child's day in detail. */}
          <h2 className="mb-3 text-lg font-bold">{`${selected.name.split(" ")[0]}'s day`}</h2>
          {placed.length > 1 ? <ChildSwitcher options={placed} activeId={selected.id} tab="" /> : null}

          <div className="mb-6 grid gap-6 xl:grid-cols-[1.6fr_1fr]">
            <TodaysUpdate today={detail[0]} studentId={selected.id} />

            <div className="flex flex-col gap-6">
              {/* Shown only when the teachers have recorded something to go over. */}
              {detail[1].items.length ? (
              <Card>
                <CardHeader>
                  <CardTitle>{t("dashboard.parent.helpAtHome")}</CardTitle>
                  <CardDescription>{`What ${selected.name.split(" ")[0]}'s teachers suggest going over at home.`}</CardDescription>
                </CardHeader>
                <CardContent>
                  <FocusList items={detail[1].items} />
                </CardContent>
              </Card>
              ) : null}

              <Card>
                <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
                  <CardTitle>{t("support.childSupport")}</CardTitle>
                  <Button asChild size="sm">
                    <Link href="/parent/concerns">+ {t("support.raiseConcern")}</Link>
                  </Button>
                </CardHeader>
                <CardContent>
                  {openSupport.length ? (
                    <ul className="divide-y text-sm">
                      {openSupport.slice(0, 4).map((row) => (
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
            </div>
          </div>
        </>
      ) : children.every((child) => child.current === false) ? (
        // No active children: the guardian may still sign in, and sees who
        // their children were, but the school has no current day to report.
        <EmptyState title={t("lifecycle.noActiveChildren")}>{t("lifecycle.noActiveChildrenHint")}</EmptyState>
      ) : (
        <EmptyState title="Not placed in a class this session">
          The school has not put {children.length === 1 ? "your child" : "any of your children"} in a
          section for the current academic year yet. Their day appears here once it does.
        </EmptyState>
      )}

      {/* 5. Notices, events, meetings and leave in one short card. */}
      <SchoolLifeCards ctx={ctx} base="/parent" />
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
