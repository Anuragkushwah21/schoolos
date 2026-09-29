import type { Metadata, Route } from "next";
import Link from "next/link";
import { PhoneIcon, UserXIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { PrintButton } from "@/components/shared/print-button";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { formatDate, formatDateTime, parseDateInput, toDateInput, today } from "@/lib/dates";
import { humanize } from "@/lib/format";
import { param } from "@/lib/search-params";
import { getCurrentSession, sectionOptions } from "@/server/academics/structure";
import { absentStudents, telHref } from "@/server/attendance/absentees";
import { requireTenant } from "@/server/auth/current-user";
import { getIntlLocale, getT } from "@/server/i18n";

export const metadata: Metadata = { title: "Absent students" };

/**
 * "2 students absent today" → who they are, which class, and a number to
 * call at home. School Admin only; the date is today unless another past day
 * is chosen, and the school always comes from the session.
 */
export default async function AbsentStudentsPage(props: PageProps<"/school-admin/attendance/absent">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const [t, intl] = await Promise.all([getT(), getIntlLocale()]);
  const search = await props.searchParams;
  const requested = parseDateInput(param(search.date));
  // A future day has no register yet, so it falls back to today.
  const date = requested && requested.getTime() <= today().getTime() ? requested : today();
  const sectionId = param(search.section);

  const session = await getCurrentSession(ctx);
  const [{ rows, total }, sections] = await Promise.all([
    absentStudents(ctx, { date, sectionId }),
    session ? sectionOptions(ctx, session.id) : Promise.resolve([]),
  ]);
  const dateLabel = formatDate(date, intl);

  // Grouped by class, in register order.
  const groups = new Map<string, typeof rows>();
  for (const row of rows) groups.set(row.section, [...(groups.get(row.section) ?? []), row]);

  return (
    <>
      <PageHeader
        icon={UserXIcon}
        tone="red"
        back={{ href: "/school-admin/attendance", label: t("nav.attendance") }}
        title={t("absentees.title")}
        description={t("absentees.description")}
        actions={total ? <PrintButton label={t("absentees.print")} /> : null}
      />

      <FilterBar
        action="/school-admin/attendance/absent"
        selects={[{ name: "section", label: t("absentees.section"), defaultValue: sectionId, allLabel: t("absentees.allSections"), options: sections }]}
        dates={[{ name: "date", label: t("absentees.date"), defaultValue: toDateInput(date), max: toDateInput(today()) }]}
      />

      {total ? (
        <>
          <p className="mb-4 text-base font-semibold">{t("absentees.summary", { count: total, date: dateLabel })}</p>
          <div className="flex flex-col gap-6">
            {[...groups.entries()].map(([section, students]) => (
              <section key={section} aria-label={section}>
                <h2 className="text-muted-foreground mb-2 text-sm font-semibold">
                  {section} · {students.length}
                </h2>
                <ul className="flex flex-col gap-3">
                  {students.map((row) => (
                    <li key={row.id} className="bg-card rounded-2xl border p-4 shadow-[0_1px_3px_rgb(15_23_42/0.06)] break-inside-avoid">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <Link href={`/school-admin/students/${row.studentId}` as Route} className="text-base font-semibold hover:underline">
                            {row.name}
                          </Link>
                          <p className="text-muted-foreground text-sm">
                            {row.section}
                            {row.rollNumber ? ` · ${t("absentees.roll", { roll: row.rollNumber })}` : ""} · {row.admissionNumber}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge status="ABSENT" />
                          <StatusBadge
                            status="INFO"
                            tone={row.absencesThisSession >= 3 ? "warning" : "neutral"}
                            label={row.absencesThisSession === 1 ? t("absentees.absentDayOne") : t("absentees.absentDays", { count: row.absencesThisSession })}
                          />
                        </div>
                      </div>

                      {row.remarks ? (
                        <p className="bg-muted mt-3 rounded-lg px-3 py-2 text-sm">
                          <span className="text-muted-foreground">{t("absentees.teacherNote")}: </span>
                          {row.remarks}
                        </p>
                      ) : null}

                      <ul className="mt-3 flex flex-col divide-y rounded-xl border">
                        {row.guardians.map((guardian) => (
                          <li key={`${guardian.name}-${guardian.phone}`} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
                            <span className="min-w-0 flex-1">
                              <span className="font-medium">{guardian.name}</span>{" "}
                              <span className="text-muted-foreground text-sm">({humanize(guardian.relationship)})</span>
                              {guardian.isPrimary ? <StatusBadge status="ACTIVE" tone="info" label={t("absentees.primary")} className="ml-2" /> : null}
                              <span className="text-muted-foreground block text-sm tabular-nums">
                                {guardian.phone}
                                {guardian.email ? ` · ${guardian.email}` : ""}
                              </span>
                            </span>
                            <Button asChild className="w-full sm:w-auto">
                              <a href={telHref(guardian.phone)} aria-label={`${t("absentees.call")} ${guardian.name}, ${guardian.phone}`}>
                                <PhoneIcon aria-hidden />
                                {t("absentees.call")}
                              </a>
                            </Button>
                          </li>
                        ))}
                        {row.emergency ? (
                          <li className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
                            <span className="min-w-0 flex-1">
                              <span className="font-medium">{row.emergency.name ?? t("absentees.emergency")}</span>{" "}
                              <span className="text-muted-foreground text-sm">({t("absentees.emergency")})</span>
                              <span className="text-muted-foreground block text-sm tabular-nums">{row.emergency.phone}</span>
                            </span>
                            <Button asChild variant="outline" className="w-full sm:w-auto">
                              <a href={telHref(row.emergency.phone)} aria-label={`${t("absentees.call")} ${row.emergency.phone}`}>
                                <PhoneIcon aria-hidden />
                                {t("absentees.call")}
                              </a>
                            </Button>
                          </li>
                        ) : null}
                        {!row.guardians.length && !row.emergency ? (
                          <li className="text-muted-foreground p-3 text-sm">{t("absentees.noGuardian")}</li>
                        ) : null}
                      </ul>

                      <p className="text-muted-foreground mt-2 text-xs">
                        {row.markedBy ? `${t("absentees.markedBy", { name: row.markedBy })} · ` : ""}
                        {formatDateTime(row.markedAt, intl)}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <p className="text-muted-foreground mt-6 text-sm">{t("absentees.parentsSeeIt")}</p>
        </>
      ) : (
        <EmptyState icon={UserXIcon} tone="green" title={t("absentees.none", { date: dateLabel })}>
          {t("absentees.noneHint")}
        </EmptyState>
      )}
    </>
  );
}
