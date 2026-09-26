import type { Metadata } from "next";
import Link from "next/link";

import { Meter, Sparkline } from "@/components/charts/bars";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EventList, NoticeList } from "@/features/communication/feed";
import { formatDayShort } from "@/lib/dates";
import { formatPercent, humanize } from "@/lib/format";
import { requireTenant } from "@/server/auth/current-user";
import { upcomingEvents } from "@/server/communication/events";
import { noticesFor } from "@/server/communication/notices";
import { getParentChildren } from "@/server/people/portal";

export const metadata: Metadata = { title: "Parent dashboard" };

export default async function ParentDashboardPage() {
  const ctx = await requireTenant("PARENT");
  const [{ children, session, date }, notices, events] = await Promise.all([
    getParentChildren(ctx),
    noticesFor(ctx, { take: 5 }),
    upcomingEvents(ctx, 4),
  ]);

  return (
    <>
      <PageHeader
        title={`Welcome, ${ctx.user.firstName}`}
        description={
          children.length
            ? `${children.length === 1 ? "Your child" : "Your children"} at ${ctx.schoolName}${session ? ` · ${session.name}` : ""}`
            : undefined
        }
      />

      {children.length ? (
        <div className="mb-8 grid gap-4 md:grid-cols-2">
          {children.map((child) => (
            <Card key={child.id}>
              <CardHeader className="flex flex-row items-start justify-between gap-3">
                <div>
                  <CardTitle>{child.name}</CardTitle>
                  <p className="text-muted-foreground text-sm">
                    {child.sectionLabel ?? "Not placed this session"}
                    {child.rollNumber ? ` · roll ${child.rollNumber}` : ""}
                  </p>
                </div>
                <span className="text-muted-foreground text-xs">{humanize(child.relationship)}</span>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-lg border p-3">
                    <p className="text-muted-foreground text-xs">{formatDayShort(date)}</p>
                    <p className="mt-1">
                      {child.todayStatus ? (
                        <StatusBadge status={child.todayStatus} />
                      ) : (
                        <span className="text-muted-foreground text-sm">Not marked</span>
                      )}
                    </p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-muted-foreground text-xs">Attendance</p>
                    <p className="mt-1 text-lg font-semibold tabular-nums">
                      {formatPercent(child.counts.PRESENT + child.counts.LATE, child.counts.total)}
                    </p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-muted-foreground text-xs">Days absent</p>
                    <p className="mt-1 text-lg font-semibold tabular-nums">{child.counts.ABSENT}</p>
                  </div>
                </div>

                {child.counts.total ? (
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <Meter
                        label="Days attended this session"
                        value={child.counts.PRESENT + child.counts.LATE}
                        max={child.counts.total}
                        tone={(child.share ?? 0) >= 0.75 ? "good" : "warning"}
                      />
                    </div>
                    {child.spark.length > 1 ? (
                      <Sparkline
                        values={child.spark}
                        ariaLabel={`${child.name}: attendance over the last ${child.spark.length} marked days`}
                      />
                    ) : null}
                  </div>
                ) : null}

                <Button asChild variant="outline" size="sm" className="w-fit">
                  <Link href={`/parent/children/${child.id}`}>Attendance and timetable</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState title="No children linked to your account yet">
          Ask the school office to link your children to your account.
        </EmptyState>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Notices</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link href="/parent/notices">All</Link>
            </Button>
          </CardHeader>
          <CardContent>
            <NoticeList notices={notices} compact />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Upcoming events</CardTitle>
          </CardHeader>
          <CardContent>
            <EventList events={events} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
