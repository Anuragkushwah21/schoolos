import type { Metadata, Route } from "next";

import Link from "next/link";
import { ChevronRightIcon, RepeatIcon } from "lucide-react";

import { NAV_ICONS } from "@/components/shared/nav-icons";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LibraryTodayPanel } from "@/features/operations/library-desk";
import { SchoolLifeCards } from "@/features/dashboard/school-life";
import { AlertList } from "@/features/parent/today";
import { STAFF_MODULE_NAV } from "@/lib/nav";
import { getStaffAlerts } from "@/server/alerts/feeds";
import { requireTenant } from "@/server/auth/current-user";
import { activeSubstitutionsAsSubstitute, requireStaffSelf, staffGrants } from "@/server/auth/staff-access";
import { getT } from "@/server/i18n";
import { libraryToday } from "@/server/operations/library";
import { assetSummary } from "@/server/operations/inventory";
import { myWorkCoversToday } from "@/server/attendance/cover";
import { orNotFound } from "@/server/page-helpers";
import { FeeDeskTodayPanel, MyAttendanceCard, MyRoutesPanel } from "@/features/staff/work-panels";
import { formatDate, toDateInput, today } from "@/lib/dates";
import { fullName, humanize } from "@/lib/format";
import { STAFF_ROLE_NAMES, type BaseStaffRole } from "@/lib/staff-access";
import { feeDeskToday, myStaffAttendance } from "@/server/staff/portal";
import { hasAssignedRoute, myAssignedRoutes } from "@/server/transport/driver";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * A staff member's day: what work they have today. One dashboard for every
 * role — which panels appear follows their grants (a librarian's desk, the
 * fee desk, today's route, the inventory), never a hard-coded per-role page.
 * Then substitutions they are covering, their attendance, school life and
 * alerts. Nothing of the School Admin's screens.
 */
export default async function StaffDashboardPage() {
  const ctx = await requireTenant("NON_TEACHING_STAFF");
  const staff = await orNotFound(requireStaffSelf(ctx));
  // Read the same way the sidebar and every guard read it: from the database,
  // with today's substitutions, and nothing at all for staff who are not current.
  const [t, alerts, grants, covers, attendance, substitutions, assignedRoute, profile] = await Promise.all([
    getT(),
    getStaffAlerts(ctx),
    staffGrants(ctx),
    myWorkCoversToday(ctx),
    myStaffAttendance(ctx),
    activeSubstitutionsAsSubstitute(ctx, staff.id),
    hasAssignedRoute(ctx),
    staff.roleProfileId ? ctx.db.staffRoleProfile.findFirst({ where: { id: staff.roleProfileId }, select: { name: true } }) : null,
  ]);
  const holds = (...keys: string[]) => keys.some((key) => (grants as string[]).includes(key));
  // Each desk's day, only for the desk they run.
  const [library, feeDesk, routes, inventory] = await Promise.all([
    holds("library.view") ? libraryToday(ctx) : null,
    holds("fees.view", "fees.collect") ? feeDeskToday(ctx) : null,
    assignedRoute ? myAssignedRoutes(ctx) : [],
    holds("inventory.view") ? assetSummary(ctx) : null,
  ]);
  const modules = STAFF_MODULE_NAV.filter(({ grants: needs, item }) => holds(...needs) && (item.href !== "/staff/my-route" || assignedRoute)).map(({ item }) => item);
  const roleName = profile?.name ?? STAFF_ROLE_NAMES[staff.role as BaseStaffRole] ?? humanize(staff.role);

  return (
    <>
      <PageHeader variant="hero" title={`${t("dashboard.staff.hello", { name: staff.firstName })} 👋`} description={`${roleName}${staff.department ? ` · ${staff.department}` : ""} · ${ctx.schoolName}`} />

      {substitutions.length ? (
        <Card className="border-warning/40 mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RepeatIcon className="text-warning-strong size-4" aria-hidden />
              You are covering as a substitute
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {substitutions.map((row) => (
                <li key={row.id} className="py-2">
                  For <strong>{fullName(row.original)}</strong> until {formatDate(row.endDate)} — their access is added to yours until then.
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {routes.length ? <MyRoutesPanel routes={routes} /> : null}

      {library ? <LibraryTodayPanel today={library} basePath="/staff/library" canManage={holds("library.circulation")} addBookHref={holds("library.books.create") ? "/staff/library#add-book" : undefined} /> : null}

      {feeDesk ? <FeeDeskTodayPanel desk={feeDesk} canCollect={holds("fees.collect")} /> : null}

      {inventory ? (
        <Card size="sm" className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-2">
              Inventory
              <Link href="/staff/inventory" className="text-primary text-sm font-medium hover:underline">
                Open →
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(["ACTIVE", "IN_REPAIR", "LOST", "DISPOSED"] as const).map((status) => (
              <div key={status} className="bg-muted/50 rounded-lg p-2 text-center">
                <p className="text-muted-foreground text-xs">{humanize(status)}</p>
                <p className="font-semibold tabular-nums">{inventory.byStatus[status] ?? 0}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {covers.length ? (
        <Card className="border-warning/40 mb-6">
          <CardHeader>
            <CardTitle>Today you are also covering</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {covers.map((cover) => (
                <li key={cover.id} className="py-2.5">
                  <span className="font-medium">
                    {cover.for} · {cover.job}
                  </span>
                  <span className="text-muted-foreground block">{cover.duties}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <div className="mb-8 grid items-start gap-6 lg:grid-cols-[1fr_18rem]">
        <section aria-labelledby="my-work">
          <h2 id="my-work" className="mb-3 text-base font-semibold">
            {t("dashboard.staff.modules")}
          </h2>
          {modules.length ? (
            <ul className="grid gap-3 sm:grid-cols-2">
              {modules.map((item) => {
                const Icon = NAV_ICONS[item.icon];
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href as Route}
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
        <MyAttendanceCard attendance={attendance} todayIso={toDateInput(today())} />
      </div>

      <SchoolLifeCards ctx={ctx} base="/staff" />

      <Card>
        <CardHeader>
          <CardTitle>{t("dashboard.forYou")}</CardTitle>
        </CardHeader>
        <CardContent>
          <AlertList alerts={alerts} emptyText={t("dashboard.nothingNew")} />
        </CardContent>
      </Card>
    </>
  );
}
