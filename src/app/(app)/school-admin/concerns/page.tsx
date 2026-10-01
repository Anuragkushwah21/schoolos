import type { Metadata } from "next";
import Link from "next/link";
import { BellRingIcon, BuildingIcon, CircleDotIcon, MessagesSquareIcon, TimerIcon } from "lucide-react";

import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { ConcernTable } from "@/features/concerns/views";
import { enumParam, param } from "@/lib/search-params";
import { CONCERN_STATUSES } from "@/lib/validation/support";
import { requireTenant } from "@/server/auth/current-user";
import { getT } from "@/server/i18n";
import { concernFilterOptions, listConcerns } from "@/server/support/concerns";

export const metadata: Metadata = { title: "Student Concerns" };

const RAISED_BY = ["PARENT", "TEACHER"] as const;

/**
 * "Student Concerns": every concern in the school — who raised it, which
 * student and subject, which teacher, when, and its status — filterable by
 * class, section, stream, subject, teacher, status and who raised it.
 */
export default async function AdminConcernsPage(props: PageProps<"/school-admin/concerns">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const search = await props.searchParams;
  const statusParam = param(search.status);
  const filters = {
    q: param(search.q),
    status: enumParam(search.status, [...CONCERN_STATUSES, "ALL", "OPEN_ALL"] as const) ?? "OPEN_ALL",
    classId: param(search.class),
    sectionId: param(search.section),
    streamId: param(search.stream),
    subjectId: param(search.subject),
    teacherId: param(search.teacher),
    assigned: param(search.assigned) === "NONE" ? ("NONE" as const) : undefined,
    raisedBy: enumParam(search.raisedBy, RAISED_BY),
  };
  const [t, rows, all, options, assigned] = await Promise.all([
    getT(),
    listConcerns(ctx, filters),
    listConcerns(ctx, { status: "OPEN_ALL" }),
    concernFilterOptions(ctx),
    // Routing needs subject teachers; without any, every concern lands here.
    ctx.db.teacherSubjectAssignment.count({ where: { academicSession: { isCurrent: true } } }),
  ]);

  return (
    <>
      <PageHeader icon={MessagesSquareIcon} tone="blue" title={t("concerns.title")} description={t("concerns.adminHint")} />

      {assigned === 0 ? (
        <div className="bg-warning-soft text-warning-strong mb-4 flex flex-col gap-2 rounded-2xl px-4 py-3 text-sm" role="status">
          <p className="font-semibold">{t("concerns.setupTitle")}</p>
          <p>{t("concerns.setupHint")}</p>
          <Link href="/school-admin/teachers" className="w-fit font-medium underline">
            {t("concerns.setupAction")} →
          </Link>
        </div>
      ) : null}

      <div className="mb-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard tone="blue" icon={CircleDotIcon} label={t("status.OPEN")} value={all.filter((row) => row.status === "OPEN").length} />
        <StatCard tone="amber" icon={TimerIcon} label={t("status.IN_PROGRESS")} value={all.filter((row) => row.status === "IN_PROGRESS").length} />
        <StatCard tone="red" icon={BuildingIcon} label={t("concerns.withOffice")} value={all.filter((row) => !row.teacher).length} hint={t("concerns.unassigned")} />
        <StatCard tone="purple" icon={BellRingIcon} label={t("concerns.updateRequestedBadge")} value={all.filter((row) => row.updateRequested).length} />
      </div>

      <FilterBar
        action="/school-admin/concerns"
        search={{ defaultValue: filters.q, placeholder: t("concerns.student") }}
        hidden={{ assigned: filters.assigned }}
        selects={[
          {
            name: "status",
            label: t("support.statusLabel"),
            defaultValue: statusParam ?? "OPEN_ALL",
            options: [
              { value: "OPEN_ALL", label: t("concerns.allOpen") },
              ...CONCERN_STATUSES.map((value) => ({ value, label: t(`status.${value}`) })),
              { value: "ALL", label: t("common.all") },
            ],
          },
          { name: "class", label: t("concerns.group"), defaultValue: filters.classId, allLabel: t("common.all"), options: options.classes },
          { name: "section", label: t("absentees.section"), defaultValue: filters.sectionId, allLabel: t("absentees.allSections"), options: options.sections },
          { name: "stream", label: t("concerns.stream"), defaultValue: filters.streamId, allLabel: t("common.all"), options: options.streams },
          { name: "subject", label: t("concerns.subject"), defaultValue: filters.subjectId, allLabel: t("common.all"), options: options.subjects },
          { name: "teacher", label: t("concerns.teacher"), defaultValue: filters.teacherId, allLabel: t("common.all"), options: options.teachers },
          {
            name: "raisedBy",
            label: t("concerns.raisedBy"),
            defaultValue: filters.raisedBy,
            allLabel: t("common.all"),
            options: RAISED_BY.map((value) => ({ value, label: t(`concerns.source.${value}`) })),
          },
        ]}
      />
      <ConcernTable rows={rows} basePath="/school-admin/concerns" />
    </>
  );
}
