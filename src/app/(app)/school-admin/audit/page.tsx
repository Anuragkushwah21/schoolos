import type { Metadata } from "next";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { Pager } from "@/components/shared/pager";
import { formatDateTime, parseDateInput, toDateInput, today } from "@/lib/dates";
import { humanize } from "@/lib/format";
import { enumParam, pageParam, param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { AUDIT_AREAS, type AuditArea, listSchoolAudit } from "@/server/audit/school";

export const metadata: Metadata = { title: "Audit log" };

const AREAS = Object.keys(AUDIT_AREAS) as AuditArea[];

/** Who did what in this school, newest first. Figures and personal details stay out of the log. */
export default async function SchoolAuditPage(props: PageProps<"/school-admin/audit">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const search = await props.searchParams;
  const filters = {
    area: enumParam(search.area, AREAS),
    q: param(search.q),
    from: parseDateInput(param(search.from)) ?? undefined,
    to: parseDateInput(param(search.to)) ?? undefined,
    page: pageParam(search.page),
  };
  const { rows, total, page, pageCount } = await listSchoolAudit(ctx, filters);

  return (
    <>
      <PageHeader title="Audit log" description="Every change made in your school: who, what and when." />
      <FilterBar
        action="/school-admin/audit"
        search={{ defaultValue: filters.q, placeholder: "Search the summary" }}
        selects={[{ name: "area", label: "Area", defaultValue: filters.area, allLabel: "Everything", options: AREAS.map((value) => ({ value, label: humanize(value) })) }]}
        dates={[
          { name: "from", label: "From", defaultValue: filters.from ? toDateInput(filters.from) : undefined, max: toDateInput(today()) },
          { name: "to", label: "To", defaultValue: filters.to ? toDateInput(filters.to) : undefined, max: toDateInput(today()) },
        ]}
      />
      {rows.length ? (
        <>
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[44rem] text-sm">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="w-44 px-3 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">What</th>
                  <th className="w-48 px-3 py-2 font-medium">Who</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t align-top">
                    <td className="text-muted-foreground px-3 py-2 tabular-nums">{formatDateTime(row.createdAt)}</td>
                    <td className="px-3 py-2">
                      {row.summary}
                      <span className="text-muted-foreground block text-xs">{humanize(row.action)}</span>
                    </td>
                    <td className="px-3 py-2">
                      {row.actor ? (
                        <>
                          {row.actor.name}
                          <span className="text-muted-foreground block text-xs">{humanize(row.actor.role)}</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">System</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} pageCount={pageCount} total={total} basePath="/school-admin/audit" params={{ area: filters.area, q: filters.q }} />
        </>
      ) : (
        <EmptyState title="Nothing recorded for these filters" />
      )}
    </>
  );
}
