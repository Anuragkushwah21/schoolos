import type { Metadata } from "next";
import Link from "next/link";
import { HeartHandshakeIcon, MessageCircleHeartIcon, PlusIcon, TrendingUpIcon, UsersIcon } from "lucide-react";

import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { Button } from "@/components/ui/button";
import { ConcernsBanner } from "@/features/concerns/views";
import { SupportTable } from "@/features/support/views";
import { enumParam, param } from "@/lib/search-params";
import { SUPPORT_PRIORITIES, SUPPORT_SOURCES, SUPPORT_STATUSES } from "@/lib/validation/support";
import { getCurrentSession, sectionOptions } from "@/server/academics/structure";
import { requireTenant } from "@/server/auth/current-user";
import { getT } from "@/server/i18n";
import { listConcerns } from "@/server/support/concerns";
import { listSupport, supportFormOptions, supportSummary } from "@/server/support/service";

export const metadata: Metadata = { title: "Students needing attention" };

/**
 * "Which students need support, and what is the school doing about it?" —
 * the summary, the parent concerns waiting, and the list, filterable by
 * class, subject, teacher, priority, status and source.
 */
export default async function AdminSupportPage(props: PageProps<"/school-admin/support">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const search = await props.searchParams;
  const statusParam = param(search.status);
  const filters = {
    q: param(search.q),
    status: enumParam(search.status, SUPPORT_STATUSES) ?? (statusParam === "ALL" ? undefined : ("OPEN" as const)),
    sectionId: param(search.section),
    subjectId: param(search.subject),
    teacherId: param(search.teacher),
    priority: enumParam(search.priority, SUPPORT_PRIORITIES),
    source: enumParam(search.source, SUPPORT_SOURCES),
  };
  const session = await getCurrentSession(ctx);
  const [t, summary, rows, concerns, options, sections] = await Promise.all([
    getT(),
    supportSummary(ctx),
    listSupport(ctx, filters),
    listConcerns(ctx),
    supportFormOptions(ctx),
    session ? sectionOptions(ctx, session.id) : Promise.resolve([]),
  ]);
  const top = summary.bySubject.slice(0, 3);
  const rest = summary.bySubject.slice(3).reduce((sum, row) => sum + row.count, 0);

  return (
    <>
      <PageHeader
        icon={HeartHandshakeIcon}
        tone="green"
        title={t("support.title")}
        description={t("support.reportHint")}
        actions={
          <Button asChild>
            <Link href="/school-admin/support/new">
              <PlusIcon aria-hidden />
              {t("support.addSupport")}
            </Link>
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard tone="blue" icon={UsersIcon} label={t("support.needsAttention")} value={summary.students} hint={t("support.studentsNeeding", { count: summary.students })} />
        <StatCard tone="amber" icon={HeartHandshakeIcon} label={t("support.inProgress")} value={(summary.byStatus.IN_PROGRESS ?? 0) + (summary.byStatus.SUPPORT_PLANNED ?? 0)} />
        <StatCard tone="green" icon={TrendingUpIcon} label={t("support.improving")} value={summary.byStatus.IMPROVING ?? 0} hint={`${t("support.resolved")}: ${summary.byStatus.RESOLVED ?? 0}`} />
        <StatCard tone="cyan" icon={MessageCircleHeartIcon} label={t("support.parentConcerns")} value={summary.concernsToReview} hint={t("support.concernsToReview", { count: summary.concernsToReview })} />
      </div>
      {summary.bySubject.length ? (
        <ul className="mb-6 flex flex-wrap gap-2 text-sm">
          {top.map((row) => (
            <li key={row.subject ?? "general"} className="bg-primary-soft text-primary-strong rounded-full px-3 py-1 font-medium">
              {row.subject ?? t("support.general")} · {row.count}
            </li>
          ))}
          {rest ? (
            <li className="bg-muted text-muted-foreground rounded-full px-3 py-1 font-medium">
              {t("support.other")} · {rest}
            </li>
          ) : null}
        </ul>
      ) : null}

      <ConcernsBanner rows={concerns} href="/school-admin/concerns" />

      <FilterBar
        action="/school-admin/support"
        search={{ defaultValue: filters.q, placeholder: t("support.student") }}
        selects={[
          {
            name: "status",
            label: t("support.statusLabel"),
            defaultValue: statusParam ?? "OPEN",
            options: [
              { value: "OPEN", label: t("support.needsAttention") },
              ...SUPPORT_STATUSES.map((value) => ({ value, label: t(`status.${value}`) })),
              { value: "ALL", label: t("common.all") },
            ],
          },
          { name: "section", label: t("absentees.section"), defaultValue: filters.sectionId, allLabel: t("absentees.allSections"), options: sections },
          { name: "subject", label: t("support.subject"), defaultValue: filters.subjectId, allLabel: t("common.all"), options: options.subjects },
          { name: "teacher", label: t("support.teacher"), defaultValue: filters.teacherId, allLabel: t("common.all"), options: options.teachers, advanced: true },
          {
            name: "priority",
            label: t("support.priorityLabel"),
            defaultValue: filters.priority,
            allLabel: t("common.all"),
            options: SUPPORT_PRIORITIES.map((value) => ({ value, label: t(`status.${value}`) })),
            advanced: true,
          },
          {
            name: "source",
            label: t("support.source"),
            defaultValue: filters.source,
            allLabel: t("common.all"),
            options: SUPPORT_SOURCES.map((value) => ({ value, label: t(`support.sourceLabel.${value}`) })),
            advanced: true,
          },
        ]}
      />
      <SupportTable rows={rows} basePath="/school-admin/support" showTeacher />
    </>
  );
}
