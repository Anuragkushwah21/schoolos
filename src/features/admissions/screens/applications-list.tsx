import { UserPlusIcon } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { ViewTabs } from "@/components/shared/view-tabs";
import { Button } from "@/components/ui/button";
import { AdmissionTabs } from "@/features/admissions/admission-tabs";
import { APPLICATION_STATUS_LABEL } from "@/features/admissions/enquiry-bits";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/dates";
import { enumParam, param } from "@/lib/search-params";
import type { TenantContext } from "@/server/auth/current-user";
import type { DeskScope } from "./scope";
import { enquiryCounts } from "@/server/admissions/enquiries";
import { applicationCounts, listApplications } from "@/server/admissions/service";


const STATUSES = ["SUBMITTED", "UNDER_REVIEW", "SHORTLISTED", "APPROVED", "CONVERTED", "REJECTED"] as const;
const SOURCE_LABEL: Record<"WEBSITE" | "WALK_IN" | "PHONE" | "ADMIN" | "DRIVE", string> = { WEBSITE: "Website", WALK_IN: "Walk-in", PHONE: "Phone", ADMIN: "Office", DRIVE: "Admission drive" };
/** The online pipeline, left to right. */
const PIPELINE = ["SUBMITTED", "UNDER_REVIEW", "SHORTLISTED", "APPROVED", "CONVERTED", "REJECTED"] as const;

/**
 * Applications from the public admission page — one per child, brothers and
 * sisters sent together marked as such. Submitted → under review →
 * shortlisted → approved → converted to a student (or rejected). Enquiries
 * are a separate list.
 */
export async function ApplicationsScreen({ ctx, search, scope }: { ctx: TenantContext; search: Record<string, string | string[] | undefined>; scope: DeskScope }) {
  const status = enumParam(search.status, STATUSES);
  // Online applications by default; "?origin=office" lists the older ones the office typed in before enquiries existed.
  const origin = param(search.origin) === "office" ? ("office" as const) : ("online" as const);
  const archived = param(search.archived) === "1";
  const q = param(search.q);
  const [applications, enquiries, counts] = await Promise.all([listApplications(ctx, { status, origin, archived, q }), scope.admin ? enquiryCounts(ctx) : null, applicationCounts(ctx)]);
  const base = origin === "office" ? `${scope.base}?origin=office` : scope.base;

  return (
    <>
      <PageHeader
        icon={UserPlusIcon}
        tone="blue"
        title={origin === "office" ? "Older office applications" : "Online admissions"}
        description={
          origin === "office"
            ? "Applications the office entered before walk-ins were recorded as enquiries. Kept with their history; new walk-ins go under Walk-in admissions."
            : "Applications parents sent through your public admission form. Review → shortlist → approve, then convert — the student form opens already filled in."
        }
        actions={
          <>
            {scope.admin ? (
              <Button asChild variant="outline">
                <Link href="/school-admin/website/admission">Admission form settings</Link>
              </Button>
            ) : null}
            <Button asChild variant="outline">
              <Link href={`/schools/${ctx.schoolSlug}/admissions`} target="_blank">
                Public form
              </Link>
            </Button>
          </>
        }
      />
      {enquiries ? <AdmissionTabs active="online" counts={{ online: counts.open, walkin: enquiries.open }} /> : null}

      {origin === "online" && !archived ? (
        // Where each online application stands: Submitted → … → Converted / Rejected.
        <ol className="mb-4 flex flex-wrap items-center gap-1.5 text-sm" aria-label="Application stages">
          {PIPELINE.map((step, index) => (
            <li key={step} className="flex items-center gap-1.5">
              {index > 0 ? <span className="text-muted-foreground" aria-hidden>{step === "REJECTED" ? "/" : "→"}</span> : null}
              <Link
                href={(status === step ? scope.base : `${scope.base}?status=${step}`) as Route}
                className={`rounded-full border px-3 py-1 ${status === step ? "border-primary bg-primary-soft" : "hover:border-primary/50"}`}
              >
                {APPLICATION_STATUS_LABEL[step]} <span className="text-muted-foreground tabular-nums">{counts.counts[step]}</span>
              </Link>
            </li>
          ))}
        </ol>
      ) : null}

      <ViewTabs
        label="Application lists"
        tabs={[
          { href: base as Route, label: "Current", active: !archived },
          { href: `${base}${base.includes("?") ? "&" : "?"}archived=1` as Route, label: "Archived", active: archived },
        ]}
      />
      <FilterBar
        action={scope.base}
        search={{ name: "q", defaultValue: q, placeholder: "Child, parent, phone or number" }}
        hidden={{ archived: archived ? "1" : undefined, origin: origin === "office" ? "office" : undefined }}
        selects={[
          { name: "status", label: "Status", defaultValue: status, allLabel: "Any status", options: STATUSES.map((value) => ({ value, label: APPLICATION_STATUS_LABEL[value]! })) },
        ]}
      />

      {applications.length ? (
        <div className="bg-card shadow-card overflow-hidden rounded-2xl border border-border/70">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Child</TableHead>
                <TableHead>Parent</TableHead>
                <TableHead>Class requested</TableHead>
                <TableHead className="hidden lg:table-cell">Source</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">Next follow-up</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {applications.map((application) => {
                const href = `${scope.base}/${application.id}` as Route;
                const canConvert = application.status === "APPROVED" && !application.createdStudentId;
                return (
                  <TableRow key={application.id}>
                    <TableCell>
                      <Link href={href} className="font-medium hover:underline">
                        {application.studentFirstName} {application.studentLastName}
                      </Link>
                      <span className="text-muted-foreground block font-mono text-xs">
                        {application.applicationNumber}
                        {application.siblings > 1 ? <span className="font-sans"> · 1 of {application.siblings} children</span> : null}
                      </span>
                    </TableCell>
                    <TableCell>
                      {application.parentName}
                      <span className="text-muted-foreground block text-xs">
                        {application.parentPhone}
                        {application.parentEmail ? ` · ${application.parentEmail}` : ""}
                      </span>
                    </TableCell>
                    <TableCell>
                      {application.requestedClass.name}
                      {application.requestedStream ? <span className="text-muted-foreground block text-xs">{application.requestedStream.name}</span> : null}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">{SOURCE_LABEL[application.source]}</TableCell>
                    <TableCell>
                      <StatusBadge status={application.status} label={APPLICATION_STATUS_LABEL[application.status]} />
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden tabular-nums md:table-cell">
                      {application.nextFollowUpOn ? formatDate(application.nextFollowUpOn) : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button asChild size="sm" variant="outline">
                          <Link href={href}>View</Link>
                        </Button>
                        {scope.admin && canConvert ? (
                          <Button asChild size="sm">
                            <Link href={`/school-admin/admissions/${application.id}/convert` as Route}>Convert</Link>
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState
          icon={UserPlusIcon}
          tone="blue"
          title={archived ? "Nothing archived" : "No applications yet"}
          action={
            <Button asChild variant="outline">
              <Link href={(scope.admin ? "/school-admin/website/admission" : scope.base) as Route}>{scope.admin ? "Set up the admission form" : "Refresh"}</Link>
            </Button>
          }
        >
          Applications sent through your public admission form appear here. Walk-ins and phone calls go under Walk-in admissions.
        </EmptyState>
      )}
    </>
  );
}
