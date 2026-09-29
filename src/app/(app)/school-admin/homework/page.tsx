import type { Metadata } from "next";
import { NotebookPenIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { Pager } from "@/components/shared/pager";
import { StatCard } from "@/components/shared/stat-card";
import { TimeStatusBadge } from "@/components/shared/time-status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/dates";
import { enumParam, pageParam, param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { getCurrentSession, sectionOptions } from "@/server/academics/structure";
import { listHomeworkForAdmin } from "@/server/classwork/homework";
import { getIntlLocale, getT } from "@/server/i18n";

export const metadata: Metadata = { title: "Homework" };

/**
 * Homework across the school, for the office to keep an eye on. Read-only:
 * teachers set and change homework from their own portal.
 */
export default async function AdminHomeworkPage(props: PageProps<"/school-admin/homework">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const [t, intl] = await Promise.all([getT(), getIntlLocale()]);
  const search = await props.searchParams;
  const filters = {
    q: param(search.q),
    sectionId: param(search.section),
    due: enumParam(search.due, ["upcoming", "today", "past"] as const),
    page: pageParam(search.page),
  };
  const session = await getCurrentSession(ctx);
  const [{ rows, total, page, pageCount, setToday, dueToday }, sections] = await Promise.all([
    listHomeworkForAdmin(ctx, filters),
    session ? sectionOptions(ctx, session.id) : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHeader icon={NotebookPenIcon} tone="purple" title={t("nav.homework")} description={t("homework.adminDescription")} />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard tone="purple" icon={NotebookPenIcon} label={t("homework.setToday")} value={setToday} />
        <StatCard tone="amber" label={t("homework.dueToday")} value={dueToday} />
        <StatCard tone="blue" label={t("homework.inView")} value={total} className="col-span-2 lg:col-span-1" />
      </div>
      <FilterBar
        action="/school-admin/homework"
        search={{ defaultValue: filters.q, placeholder: t("homework.searchPlaceholder") }}
        selects={[
          { name: "section", label: t("tabs.classesSections"), defaultValue: filters.sectionId, allLabel: t("common.all"), options: sections },
          {
            name: "due",
            label: t("homework.due"),
            defaultValue: filters.due,
            allLabel: t("common.all"),
            options: [
              { value: "upcoming", label: t("status.ASSIGNED") },
              { value: "today", label: t("status.DUE_TODAY") },
              { value: "past", label: t("homework.pastDue") },
            ],
          },
        ]}
      />
      {rows.length ? (
        <div className="bg-card overflow-x-auto rounded-2xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("homework.title")}</TableHead>
                <TableHead>{t("tabs.classesSections")}</TableHead>
                <TableHead className="hidden md:table-cell">{t("tabs.teachers")}</TableHead>
                <TableHead>{t("homework.due")}</TableHead>
                <TableHead>{t("homework.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="max-w-xs whitespace-normal">
                    <span className="font-medium">{row.title}</span>
                    <span className="text-muted-foreground block text-xs">
                      {row.subject}
                      {row.resources ? ` · ${row.resources} 📎` : ""}
                    </span>
                  </TableCell>
                  <TableCell>{row.section}</TableCell>
                  <TableCell className="hidden md:table-cell">{row.teacher}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatDate(row.dueOn, intl)}</TableCell>
                  <TableCell>
                    {/* Past its due date is simply "past due" here: the office sees work set, not who handed it in. */}
                    <TimeStatusBadge status={row.timeStatus === "OVERDUE" ? "COMPLETED" : row.timeStatus} label={row.timeStatus === "OVERDUE" ? t("homework.pastDue") : undefined} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState icon={NotebookPenIcon} tone="purple" title={t("homework.empty")}>
          {t("homework.emptyHint")}
        </EmptyState>
      )}
      <Pager page={page} pageCount={pageCount} total={total} basePath="/school-admin/homework" params={{ q: filters.q, section: filters.sectionId, due: filters.due }} />
    </>
  );
}
