import type { Metadata, Route } from "next";
import Link from "next/link";
import { FileBadgeIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ApprovalForms } from "@/features/documents/forms";
import { DOCUMENT_STATUS } from "@/features/documents/person-documents";
import { formatDate } from "@/lib/dates";
import { DOCUMENT_TYPES, DOCUMENTS, documentLabel } from "@/lib/documents";
import { enumParam } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { listDocuments } from "@/server/documents/service";
import { principalUserIdFor } from "@/server/people/principals";

export const metadata: Metadata = { title: "Documents" };

const STATUSES = ["GENERATED", "PENDING_APPROVAL", "ISSUED", "REVOKED", "SUPERSEDED"] as const;

/** The school's document register: everything generated or issued, newest first. Nothing is ever deleted. */
export default async function DocumentsRegisterPage(props: PageProps<"/school-admin/documents">) {
  const ctx = await requireTenant("SCHOOL_ADMIN", "PRINCIPAL");
  const search = await props.searchParams;
  const type = enumParam(search.type, DOCUMENT_TYPES) ?? null;
  const status = enumParam(search.status, STATUSES) ?? null;
  const rows = await listDocuments(ctx, { type, status });
  // The Principal's own documents link to their profile (School Admin only — the Principal's register leaves them out).
  const principals = ctx.user.role === "SCHOOL_ADMIN" ? await principalUserIdFor(ctx, rows.flatMap((row) => (row.principalProfileId ? [row.principalProfileId] : []))) : new Map<string, string>();
  const types = DOCUMENT_TYPES.filter((key) => ctx.user.role === "SCHOOL_ADMIN" || !DOCUMENTS[key].employment);
  const profile = (row: (typeof rows)[number]) => (row.studentId ? `/school-admin/students/${row.studentId}?tab=documents` : row.teacherId ? `/school-admin/teachers/${row.teacherId}?tab=documents` : row.principalProfileId ? `/school-admin/principal/${principals.get(row.principalProfileId) ?? ""}` : `/school-admin/staff/${row.staffMemberId}?tab=documents`) as Route;
  const pending = rows.filter((row) => row.status === "PENDING_APPROVAL");
  return (
    <>
      <PageHeader
        icon={FileBadgeIcon}
        tone="blue"
        title="Documents"
        description="Every certificate, letter, ID card and marksheet made for the school's people. Make new ones from a profile, or tick rows on the student, teacher or staff list."
        actions={
          ctx.user.role === "SCHOOL_ADMIN" ? (
            <Button asChild variant="outline">
              <Link href={"/school-admin/settings/documents" as Route}>Document settings</Link>
            </Button>
          ) : undefined
        }
      />
      <FilterBar
        action="/school-admin/documents"
        selects={[
          { name: "type", label: "Document", allLabel: "All documents", defaultValue: type ?? "", options: types.map((key) => ({ value: key, label: DOCUMENTS[key].label })) },
          { name: "status", label: "Status", allLabel: "All", defaultValue: status ?? "", options: STATUSES.map((key) => ({ value: key, label: DOCUMENT_STATUS[key]!.label })) },
        ]}
      />
      {pending.length ? (
        <section className="border-warning/30 bg-warning-soft mt-4 flex flex-col gap-3 rounded-xl border p-4">
          <p className="text-warning-strong font-semibold">{pending.length === 1 ? "1 transfer certificate waiting for approval" : `${pending.length} transfer certificates waiting for approval`}</p>
          {pending.map((row) => (
            <div key={row.id} className="bg-card flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm">
              <span className="min-w-0 flex-1">
                <span className="font-medium">{`${documentLabel(row.type)} — ${row.person}`}</span>
                <Link href={`/documents/print?ids=${row.id}` as Route} target="_blank" className="text-primary ml-2 text-xs hover:underline">
                  Check it
                </Link>
              </span>
              <ApprovalForms documentId={row.id} mine={row.generatedById === ctx.user.id} />
            </div>
          ))}
        </section>
      ) : null}
      {rows.length ? (
        <div className="mt-4 overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Document</TableHead>
                <TableHead>For</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Print</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    {documentLabel(row.type)}
                    {row.number ? <p className="text-muted-foreground text-xs">{row.number}</p> : null}
                  </TableCell>
                  <TableCell>
                    <Link href={profile(row)} className="hover:underline">
                      {row.person}
                    </Link>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{formatDate(row.issuedOn)}</TableCell>
                  <TableCell>
                    <StatusBadge status={row.status} label={DOCUMENT_STATUS[row.status]!.label} tone={DOCUMENT_STATUS[row.status]!.tone} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild variant="ghost" size="xs">
                      <Link href={`/documents/print?ids=${row.id}` as Route} target="_blank">
                        Print / PDF
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState title="No documents yet">Open a profile and choose a document to make the first one.</EmptyState>
      )}
    </>
  );
}
