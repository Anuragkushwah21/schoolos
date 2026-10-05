import { ContactRoundIcon, PlusIcon } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { ViewTabs } from "@/components/shared/view-tabs";
import { Button } from "@/components/ui/button";
import { AdmissionTabs } from "@/features/admissions/admission-tabs";
import { ClassBadge, ENQUIRY_SOURCE_LABEL, ENQUIRY_STATUS_LABEL, FEE_STATUS_LABEL } from "@/features/admissions/enquiry-bits";
import { rupees } from "@/features/finance/money";
import { formatDate, parseDateInput, today } from "@/lib/dates";
import { enumParam, param } from "@/lib/search-params";
import { streamRuleForLevel } from "@/lib/stream-rules";
import { cn } from "@/lib/utils";
import { ENQUIRY_STATUSES } from "@/lib/validation/enquiries";
import { listClasses, listStreams } from "@/server/academics/structure";
import { enquiryCounts, listEnquiries } from "@/server/admissions/enquiries";
import { applicationCounts } from "@/server/admissions/service";
import { requireTenant } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Walk-in admissions" };

const VIEWS = ["open", "converted", "closed", "all"] as const;
const FOLLOW_UPS = ["due", "today", "week"] as const;

/**
 * Family enquiries: interest, not admissions. One card per family — the
 * parent, every child with class and stream, the fee discussion and the next
 * follow-up. Searching any child's name finds the family.
 */
export default async function EnquiriesPage(props: PageProps<"/school-admin/admissions/enquiries">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const search = await props.searchParams;
  const view = enumParam(search.view, VIEWS) ?? "open";
  const status = enumParam(search.status, ENQUIRY_STATUSES);
  const followUp = enumParam(search.followUp, FOLLOW_UPS);
  const q = param(search.q);
  const classId = param(search.classId);
  const streamId = param(search.streamId);
  const from = param(search.from);
  const to = param(search.to);
  const [rows, counts, classes, streams, online] = await Promise.all([
    listEnquiries(ctx, { view, status, q, classId, streamId, followUp, from: from ? parseDateInput(from) : null, to: to ? parseDateInput(to) : null }),
    enquiryCounts(ctx),
    listClasses(ctx, { activeOnly: true }),
    listStreams(ctx, { activeOnly: true }),
    applicationCounts(ctx),
  ]);
  const href = (next: string) => `/school-admin/admissions/enquiries${next}` as Route;

  return (
    <>
      <PageHeader
        icon={ContactRoundIcon}
        tone="purple"
        title="Walk-in admissions"
        description="Families the office records itself — walk-ins, phone calls, referrals. One enquiry can have several children: follow up, discuss fees (nothing is charged), then convert each child into a student."
        actions={
          <Button asChild>
            <Link href="/school-admin/admissions/enquiries/new">
              <PlusIcon aria-hidden />
              New walk-in enquiry
            </Link>
          </Button>
        }
      />
      <AdmissionTabs active="walkin" counts={{ online: online.open, walkin: counts.open }} />
      {online.office ? (
        <p className="text-muted-foreground mb-4 text-sm">
          {online.office} older {online.office === 1 ? "application was" : "applications were"} entered by the office before walk-ins were recorded here —{" "}
          <Link href={"/school-admin/admissions?origin=office" as Route} className="text-primary underline">
            see them
          </Link>
          .
        </p>
      ) : null}

      <ViewTabs
        label="Enquiry status"
        tabs={[
          { href: "/school-admin/admissions/enquiries", label: "Open", active: view === "open" && !status && !followUp, count: counts.open },
          { href: "/school-admin/admissions/enquiries?followUp=due", label: "Follow-up due", active: followUp === "due", count: counts.due },
          { href: "/school-admin/admissions/enquiries?view=converted", label: "Converted", active: view === "converted" },
          { href: "/school-admin/admissions/enquiries?view=closed", label: "Closed", active: view === "closed" },
          { href: "/school-admin/admissions/enquiries?view=all", label: "All", active: view === "all" },
        ]}
      />
      <FilterBar
        action="/school-admin/admissions/enquiries"
        search={{ name: "q", defaultValue: q, placeholder: "Parent, child, mobile, email or ENQ number" }}
        hidden={{ view: view === "open" ? undefined : view }}
        selects={[
          { name: "status", label: "Status", defaultValue: status, allLabel: "Any status", options: ENQUIRY_STATUSES.map((value) => ({ value, label: ENQUIRY_STATUS_LABEL[value]! })) },
          { name: "classId", label: "Class", defaultValue: classId, allLabel: "Any class", options: classes.map((row) => ({ value: row.id, label: row.name })) },
          { name: "streamId", label: "Stream", defaultValue: streamId, allLabel: "Any stream", options: streams.map((row) => ({ value: row.id, label: row.name })), advanced: true },
          { name: "followUp", label: "Follow-up", defaultValue: followUp, allLabel: "Any follow-up", options: [{ value: "due", label: "Due or overdue" }, { value: "today", label: "Today" }, { value: "week", label: "Next 7 days" }], advanced: true },
        ]}
        dates={[
          { name: "from", label: "Received from", defaultValue: from },
          { name: "to", label: "to", defaultValue: to },
        ]}
      />

      {rows.length ? (
        <ul className="grid gap-4 lg:grid-cols-2">
          {rows.map((row) => (
            <li key={row.id} className={cn("bg-card shadow-card flex flex-col gap-3 rounded-2xl border p-4 sm:p-5", row.followUpDue && "border-warning/60")}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <Link href={href(`/${row.id}`)} className="text-base font-semibold hover:underline">
                    {row.parentName}
                  </Link>
                  <p className="text-muted-foreground text-xs">
                    <span className="font-mono">{row.enquiryNumber}</span> · {row.phone}
                    {row.email ? ` · ${row.email}` : ""} · {ENQUIRY_SOURCE_LABEL[row.source]} · {formatDate(today(row.createdAt))}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <StatusBadge status={row.status} label={ENQUIRY_STATUS_LABEL[row.status]} />
                  <StatusBadge status={row.feeStatus} label={`Fee: ${FEE_STATUS_LABEL[row.feeStatus]}`} />
                </div>
              </div>

              <p className="text-sm font-medium">
                {row.children.length} {row.children.length === 1 ? "child" : "children"}
              </p>
              <ul className="flex flex-col gap-1.5">
                {row.children.map((child) => {
                  const matched = row.matchedChildren.some((match) => match.id === child.id);
                  return (
                    <li key={child.id} className={cn("flex flex-wrap items-center gap-2 text-sm", matched && "bg-warning-soft/60 -mx-2 rounded-lg px-2 py-1")}>
                      <span className={cn(child.status === "WITHDRAWN" && "text-muted-foreground line-through")}>{[child.firstName, child.lastName].filter(Boolean).join(" ")}</span>
                      <ClassBadge>{child.class.name}</ClassBadge>
                      {child.stream ? (
                        <span className="bg-purple-soft text-purple-strong rounded-full px-2 py-0.5 text-xs font-semibold">{child.stream.name}</span>
                      ) : streamRuleForLevel(child.class.level) === "OPTIONAL" ? (
                        <span className="text-muted-foreground text-xs">stream optional</span>
                      ) : null}
                      {child.status === "ADMITTED" ? <StatusBadge status="ADMITTED" label="Admitted" /> : null}
                    </li>
                  );
                })}
              </ul>

              {row.totals.discussedChildren ? (
                <dl className="bg-muted/40 grid grid-cols-3 gap-2 rounded-xl p-3 text-sm">
                  <div>
                    <dt className="text-muted-foreground text-xs">Discussed</dt>
                    <dd className="font-semibold tabular-nums">{rupees(row.totals.originalMinor)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">Total discount</dt>
                    <dd className="text-success-strong font-semibold tabular-nums">{rupees(row.totals.totalDiscountMinor)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">Final family</dt>
                    <dd className="text-primary-strong font-bold tabular-nums">{rupees(row.totals.finalMinor)}</dd>
                  </div>
                </dl>
              ) : null}

              <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                <p className={cn("text-sm", row.followUpDue ? "text-warning-strong font-semibold" : "text-muted-foreground")}>
                  {row.nextFollowUpOn ? `Next follow-up ${formatDate(row.nextFollowUpOn)}${row.followUpDue ? " — due" : ""}` : "No follow-up set"}
                  {row.nextAction ? ` · ${row.nextAction}` : ""}
                </p>
                <div className="flex gap-1.5">
                  <Button asChild size="sm" variant="outline">
                    <Link href={href(`/${row.id}`)}>View</Link>
                  </Button>
                  {row.status !== "CONVERTED" && row.status !== "CLOSED" ? (
                    <Button asChild size="sm" variant="outline">
                      <Link href={href(`/${row.id}/edit`)}>Edit</Link>
                    </Button>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={ContactRoundIcon}
          tone="purple"
          title={q || status || classId || followUp ? "No enquiries match" : "No enquiries here"}
          action={
            <Button asChild>
              <Link href="/school-admin/admissions/enquiries/new">New enquiry</Link>
            </Button>
          }
        >
          Record a walk-in, phone call or referral — for one child or the whole family.
        </EmptyState>
      )}
    </>
  );
}
