import type { Metadata } from "next";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { Pager } from "@/components/shared/pager";
import { parseDateInput, toDateInput, today } from "@/lib/dates";
import { humanize } from "@/lib/format";
import { enumParam, pageParam, param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { AUDIT_AREAS, type AuditArea, auditFilterOptions, listSchoolAudit } from "@/server/audit/school";
import { AuditEntries } from "@/features/audit/audit-entries";

export const metadata: Metadata = { title: "Audit log" };

const AREAS = Object.keys(AUDIT_AREAS) as AuditArea[];

/** Who did what in this school, newest first. Figures and personal details stay out of the log. */
export default async function SchoolAuditPage(props: PageProps<"/school-admin/audit">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const search = await props.searchParams;
  const options = await auditFilterOptions(ctx);
  const pick = (value: string | undefined, list: Array<{ value: string }>) => (value && list.some((row) => row.value === value) ? value : undefined);
  const filters = {
    area: enumParam(search.area, AREAS),
    q: param(search.q),
    from: parseDateInput(param(search.from)) ?? undefined,
    to: parseDateInput(param(search.to)) ?? undefined,
    page: pageParam(search.page),
    actorId: pick(param(search.actor), options.actors),
    actorRole: pick(param(search.role), options.roles),
    module: pick(param(search.module), options.modules),
    action: options.actions.includes(param(search.action) ?? "") ? param(search.action) : undefined,
  };
  const { rows, total, page, pageCount } = await listSchoolAudit(ctx, filters);

  return (
    <>
      <PageHeader title="Audit log" description="Every change made in your school: who really did it, in which module, and when. Entries are never edited or deleted." />
      <FilterBar
        action="/school-admin/audit"
        search={{ defaultValue: filters.q, placeholder: "Search the summary" }}
        selects={[
          { name: "actor", label: "Person", defaultValue: filters.actorId, allLabel: "Everyone", options: options.actors },
          { name: "role", label: "Role", defaultValue: filters.actorRole, allLabel: "All roles", options: options.roles },
          { name: "module", label: "Module", defaultValue: filters.module, allLabel: "All modules", options: options.modules },
          { name: "action", label: "Action", defaultValue: filters.action, allLabel: "All actions", options: options.actions.map((value) => ({ value, label: humanize(value) })), advanced: true },
          { name: "area", label: "Area", defaultValue: filters.area, allLabel: "Everything", options: AREAS.map((value) => ({ value, label: humanize(value) })), advanced: true },
        ]}
      />
      <FilterBar
        action="/school-admin/audit"
        hidden={{ actor: filters.actorId, role: filters.actorRole, module: filters.module, action: filters.action, q: filters.q }}
        dates={[
          { name: "from", label: "From", defaultValue: filters.from ? toDateInput(filters.from) : undefined, max: toDateInput(today()) },
          { name: "to", label: "To", defaultValue: filters.to ? toDateInput(filters.to) : undefined, max: toDateInput(today()) },
        ]}
      />
      {rows.length ? (
        <>
          <div className="bg-card rounded-xl border px-4">
            <AuditEntries rows={rows} />
          </div>
          <Pager
            page={page}
            pageCount={pageCount}
            total={total}
            basePath="/school-admin/audit"
            params={{ area: filters.area, q: filters.q, actor: filters.actorId, role: filters.actorRole, module: filters.module, action: filters.action }}
          />
        </>
      ) : (
        <EmptyState title="Nothing recorded for these filters" />
      )}
    </>
  );
}
