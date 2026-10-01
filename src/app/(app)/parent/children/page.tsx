import type { Metadata, Route } from "next";
import Link from "next/link";
import { CalendarOffIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { ChildCard } from "@/features/parent/child-nav";
import { today } from "@/lib/dates";
import { attendedShare, emptyCounts } from "@/server/attendance/service";
import { requireTenant } from "@/server/auth/current-user";
import { listMyChildren } from "@/server/parent/access";

export const metadata: Metadata = { title: "My children" };

/**
 * Every child linked to this guardian.
 *
 * The list comes from the `ParentStudent` table, so there is nothing here to
 * filter on the client and nothing a crafted URL could add to it.
 */
export default async function ParentChildrenPage() {
  const ctx = await requireTenant("PARENT");
  const { children } = await listMyChildren(ctx);

  if (children.length === 0) {
    return (
      <>
        <PageHeader title="My children" />
        <EmptyState title="No children are linked to your account yet">
          The school office links a guardian to their children. Ask them to add yours.
        </EmptyState>
      </>
    );
  }

  const studentIds = children.map((child) => child.id);
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

  return (
    <>
      <PageHeader
        title="My children"
        description="One sign-in covers every child the school has linked to you."
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {children.map((child) => (
          <div key={child.id} className="flex flex-col gap-2">
            <ChildCard
              child={child}
              attendanceShare={counts.has(child.id) ? attendedShare(counts.get(child.id)!) : null}
              todayStatus={todayByChild.get(child.id) ?? null}
            />
            {child.current ? (
              <Button asChild variant="outline" size="sm" className="w-fit">
                <Link href={`/parent/leave?child=${child.id}` as Route}>
                  <CalendarOffIcon aria-hidden />
                  Apply Leave
                </Link>
              </Button>
            ) : null}
          </div>
        ))}
      </div>
    </>
  );
}
