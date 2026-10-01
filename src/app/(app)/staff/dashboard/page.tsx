import type { Metadata } from "next";

import { effectiveStaffPermissions } from "@/lib/validation/operations";
import Link from "next/link";
import { ChevronRightIcon } from "lucide-react";

import { NAV_ICONS } from "@/components/shared/nav-icons";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LibraryTodayPanel } from "@/features/operations/library-desk";
import { SchoolLifeCards } from "@/features/dashboard/school-life";
import { AlertList } from "@/features/parent/today";
import { humanize } from "@/lib/format";
import { STAFF_PERMISSION_NAV } from "@/lib/nav";
import { getStaffAlerts } from "@/server/alerts/feeds";
import { requireTenant } from "@/server/auth/current-user";
import { requireStaffSelf } from "@/server/auth/staff-access";
import { getT } from "@/server/i18n";
import { libraryToday } from "@/server/operations/library";
import { myWorkCoversToday } from "@/server/attendance/cover";
import { orNotFound } from "@/server/page-helpers";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * A staff member's day: their work (the modules the office granted them),
 * then events, leave, notices and meetings as compact cards. Nothing of the
 * School Admin's screens.
 */
export default async function StaffDashboardPage() {
  const ctx = await requireTenant("NON_TEACHING_STAFF");
  const staff = await orNotFound(requireStaffSelf(ctx));
  const [t, alerts] = await Promise.all([getT(), getStaffAlerts(ctx)]);
  // Work the office handed over for today, on top of their own.
  const covers = await myWorkCoversToday(ctx);
  // The librarian's day starts with the desk, not with meetings.
  const permissions = effectiveStaffPermissions(staff);
  const runsLibrary = permissions.includes("MANAGE_LIBRARY");
  const library = runsLibrary ? await libraryToday(ctx) : null;

  return (
    <>
      <PageHeader variant="hero"
        title={`${t("dashboard.staff.hello", { name: staff.firstName })} 👋`}
        description={`${humanize(staff.role)}${staff.department ? ` · ${staff.department}` : ""} · ${ctx.schoolName}`}
      />

      {library ? <LibraryTodayPanel today={library} basePath="/staff/library" canManage addBookHref="/staff/library#add-book" /> : null}

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

      <section aria-labelledby="my-work" className="mb-8">
        <h2 id="my-work" className="mb-3 text-base font-semibold">
          {t("dashboard.staff.modules")}
        </h2>
        {permissions.length ? (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {permissions
              // "View library" and "Run the library" open the same page: one tile.
              .filter((permission, index, all) => all.findIndex((other) => STAFF_PERMISSION_NAV[other].href === STAFF_PERMISSION_NAV[permission].href) === index)
              .map((permission) => {
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
