import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRightIcon, HandshakeIcon, MegaphoneIcon } from "lucide-react";

import { NAV_ICONS } from "@/components/shared/nav-icons";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { TimeStatusBadge } from "@/components/shared/time-status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertList } from "@/features/parent/today";
import { formatDate } from "@/lib/dates";
import { humanize } from "@/lib/format";
import { STAFF_PERMISSION_NAV } from "@/lib/nav";
import { getStaffAlerts } from "@/server/alerts/feeds";
import { requireTenant } from "@/server/auth/current-user";
import { requireStaffSelf } from "@/server/auth/staff-access";
import { myMeetings } from "@/server/communication/meetings";
import { noticesFor } from "@/server/communication/notices";
import { getIntlLocale, getT } from "@/server/i18n";
import { orNotFound } from "@/server/page-helpers";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * A staff member's day: their work (the modules the office granted them),
 * meetings coming up and notices. Nothing of the School Admin's screens.
 */
export default async function StaffDashboardPage() {
  const ctx = await requireTenant("NON_TEACHING_STAFF");
  const staff = await orNotFound(requireStaffSelf(ctx));
  const [t, intl, meetings, notices, alerts] = await Promise.all([
    getT(),
    getIntlLocale(),
    myMeetings(ctx, { pastLimit: 0 }),
    noticesFor(ctx, { take: 5 }),
    getStaffAlerts(ctx),
  ]);
  const next = meetings.upcoming.filter((meeting) => meeting.timeStatus !== "CANCELLED");

  return (
    <>
      <PageHeader
        title={`${t("dashboard.staff.hello", { name: staff.firstName })} 👋`}
        description={`${humanize(staff.role)}${staff.department ? ` · ${staff.department}` : ""} · ${ctx.schoolName}`}
      />

      <section aria-labelledby="my-work" className="mb-8">
        <h2 id="my-work" className="mb-3 text-base font-semibold">
          {t("dashboard.staff.modules")}
        </h2>
        {staff.permissions.length ? (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {staff.permissions.map((permission) => {
              const item = STAFF_PERMISSION_NAV[permission];
              const Icon = NAV_ICONS[item.icon];
              return (
                <li key={permission}>
                  <Link
                    href={item.href}
                    className="bg-card hover:border-primary/50 hover:bg-primary-soft flex min-h-16 items-center gap-3 rounded-xl border p-4 font-medium shadow-[0_1px_3px_rgb(15_23_42/0.06)] transition-colors"
                  >
                    <span className="bg-primary-soft text-primary-strong flex size-10 items-center justify-center rounded-lg">
                      <Icon className="size-5" aria-hidden />
                    </span>
                    <span className="flex-1">{t(item.labelKey)}</span>
                    <ChevronRightIcon className="text-muted-foreground size-4" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-muted-foreground rounded-xl border border-dashed p-4 text-sm">{t("dashboard.staff.noModules")}</p>
        )}
      </section>

      <div className="mb-6 grid grid-cols-2 gap-4">
        <StatCard tone="cyan" icon={HandshakeIcon} label={t("dashboard.staff.upcomingMeetings")} value={next.length} href="/staff/meetings" />
        <StatCard tone="amber" icon={MegaphoneIcon} label={t("dashboard.staff.notices")} value={notices.length} href="/staff/notices" />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("dashboard.forYou")}</CardTitle>
          </CardHeader>
          <CardContent>
            <AlertList alerts={alerts} emptyText={t("dashboard.nothingNew")} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("dashboard.staff.nextMeetings")}</CardTitle>
          </CardHeader>
          <CardContent>
            {next.length ? (
              <ul className="divide-y text-sm">
                {next.slice(0, 5).map((meeting) => (
                  <li key={meeting.id} className="flex flex-wrap items-center gap-2 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{meeting.title}</span>
                      <span className="text-muted-foreground block text-xs">
                        {formatDate(meeting.date, intl)} · {meeting.time}
                        {meeting.location ? ` · ${meeting.location}` : ""}
                      </span>
                    </span>
                    <TimeStatusBadge status={meeting.timeStatus} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">{t("dashboard.staff.noMeetings")}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
