import { MessageSquareWarningIcon } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/forms/action-form";
import { SelectField, SubmitButton } from "@/components/forms/fields";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { bulkComplaintStatusAction } from "@/features/communication/complaint-actions";
import { COMPLAINT_TONE, PRIORITY_TONE } from "@/features/communication/complaint-views";
import { formatDate } from "@/lib/dates";
import { fullName, humanize } from "@/lib/format";
import { enumParam, param } from "@/lib/search-params";
import { COMPLAINT_CATEGORIES, COMPLAINT_PRIORITIES, COMPLAINT_STATUSES } from "@/lib/validation/complaints";
import { requireTenant } from "@/server/auth/current-user";
import { listComplaints } from "@/server/communication/complaints";

export const metadata: Metadata = { title: "Complaints" };

const opts = (values: readonly string[]) => values.map((value) => ({ value, label: humanize(value) }));

export default async function AdminComplaintsPage(props: PageProps<"/school-admin/complaints">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const search = await props.searchParams;
  const filters = {
    q: param(search.q),
    status: enumParam(search.status, COMPLAINT_STATUSES),
    category: enumParam(search.category, COMPLAINT_CATEGORIES),
    priority: enumParam(search.priority, COMPLAINT_PRIORITIES),
  };
  const rows = await listComplaints(ctx, filters);

  return (
    <>
      <PageHeader icon={MessageSquareWarningIcon} tone="red" title="Complaints" description="Requests and complaints from parents and students." />
      <FilterBar
        action="/school-admin/complaints"
        search={{ defaultValue: filters.q, placeholder: "Subject, details, student or admission no." }}
        selects={[
          { name: "status", label: "Status", defaultValue: filters.status, allLabel: "Any status", options: opts(COMPLAINT_STATUSES) },
          { name: "category", label: "Category", defaultValue: filters.category, allLabel: "Any category", options: opts(COMPLAINT_CATEGORIES) },
          { name: "priority", label: "Priority", defaultValue: filters.priority, allLabel: "Any priority", options: opts(COMPLAINT_PRIORITIES) },
        ]}
      />
      {rows.length ? (
        <ActionForm action={bulkComplaintStatusAction}>
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[48rem] text-sm">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="w-10 px-3 py-2">
                    <span className="sr-only">Select</span>
                  </th>
                  <th className="px-3 py-2 font-medium">Subject</th>
                  <th className="px-3 py-2 font-medium">From</th>
                  <th className="px-3 py-2 font-medium">Priority</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Assigned</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t">
                    <td className="px-3 py-2">
                      <input type="checkbox" name="complaintIds" value={row.id} aria-label="Select complaint" className="accent-primary size-4" />
                    </td>
                    <td className="px-3 py-2">
                      <Link href={`/school-admin/complaints/${row.id}` as Route} className="font-medium hover:underline">
                        {row.subject}
                      </Link>
                      <span className="text-muted-foreground block text-xs">
                        {humanize(row.category)} · {formatDate(row.createdAt)}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {row.raisedBy ? fullName(row.raisedBy) : "—"}
                      {row.student ? <span className="text-muted-foreground block text-xs">about {fullName(row.student)}</span> : null}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={row.priority} tone={PRIORITY_TONE[row.priority]} />
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={row.status} tone={COMPLAINT_TONE[row.status]} />
                    </td>
                    <td className="text-muted-foreground px-3 py-2">{row.assignedTo ? fullName(row.assignedTo) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <SelectField name="status" label="Set selected to" options={opts(COMPLAINT_STATUSES)} placeholder="Choose a status" className="w-56" />
            <SubmitButton pendingLabel="Updating…">Update selected</SubmitButton>
          </div>
        </ActionForm>
      ) : (
        <EmptyState title="No complaints here.">When a parent or student raises a concern, it appears here for you to answer.</EmptyState>
      )}
    </>
  );
}
