import type { Metadata } from "next";

import { ActionButton } from "@/components/forms/action-button";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { setInquiryStatusAction } from "@/features/marketing/contact-actions";
import { INQUIRY_TOPIC_OPTIONS } from "@/features/marketing/topics";
import { formatDateTime } from "@/lib/dates";
import { enumParam } from "@/lib/search-params";
import { INQUIRY_STATUSES } from "@/lib/validation/platform";
import { requireSuperAdmin } from "@/server/auth/current-user";
import { listInquiries } from "@/server/platform/inquiries";

export const metadata: Metadata = { title: "Enquiries" };

const STATUS = {
  NEW: { label: "New", tone: "warning" },
  CONTACTED: { label: "Contacted", tone: "positive" },
  CLOSED: { label: "Closed", tone: "neutral" },
} as const;

const TOPIC_LABEL = Object.fromEntries(INQUIRY_TOPIC_OPTIONS.map((o) => [o.value, o.label]));

/** Messages from the public contact page, newest first. Super Admin only. */
export default async function InquiriesPage(props: PageProps<"/super-admin/inquiries">) {
  const actor = await requireSuperAdmin();
  const search = await props.searchParams;
  const status = enumParam(search.status, INQUIRY_STATUSES) ?? null;
  const { rows, counts } = await listInquiries(actor, { status });

  return (
    <>
      <PageHeader
        title="Enquiries"
        description="Messages sent from the Contact page on the SchoolOS website."
      />

      <div className="mb-6 grid grid-cols-3 gap-4">
        <StatCard label="New" value={counts.NEW} href="/super-admin/inquiries?status=NEW" />
        <StatCard label="Contacted" value={counts.CONTACTED} href="/super-admin/inquiries?status=CONTACTED" />
        <StatCard label="Closed" value={counts.CLOSED} href="/super-admin/inquiries?status=CLOSED" />
      </div>

      <FilterBar
        action="/super-admin/inquiries"
        selects={[
          {
            name: "status",
            label: "Status",
            defaultValue: status ?? "",
            allLabel: "All enquiries",
            options: INQUIRY_STATUSES.map((value) => ({ value, label: STATUS[value].label })),
          },
        ]}
      />

      {rows.length ? (
        <div className="flex flex-col gap-4">
          {rows.map((row) => (
            <Card key={row.id}>
              <CardContent className="flex flex-col gap-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {row.name}
                      {row.schoolName ? <span className="text-muted-foreground"> · {row.schoolName}</span> : null}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {TOPIC_LABEL[row.topic] ?? row.topic} · {formatDateTime(row.createdAt)}
                      {row.city ? ` · ${row.city}` : ""}
                    </p>
                  </div>
                  <StatusBadge status={row.status} label={STATUS[row.status].label} tone={STATUS[row.status].tone} />
                </div>

                <p className="text-sm whitespace-pre-line">{row.message}</p>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <a href={`mailto:${row.email}`} className="text-primary hover:underline">
                    {row.email}
                  </a>
                  {row.phone ? (
                    <a href={`tel:${row.phone.replace(/\s+/g, "")}`} className="text-primary hover:underline">
                      {row.phone}
                    </a>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-2">
                  {row.status !== "CONTACTED" ? (
                    <ActionButton
                      action={setInquiryStatusAction}
                      fields={{ inquiryId: row.id, status: "CONTACTED" }}
                      variant="outline"
                      pendingLabel="Saving…"
                    >
                      Mark contacted
                    </ActionButton>
                  ) : null}
                  {row.status !== "CLOSED" ? (
                    <ActionButton
                      action={setInquiryStatusAction}
                      fields={{ inquiryId: row.id, status: "CLOSED" }}
                      variant="ghost"
                      pendingLabel="Saving…"
                    >
                      Close
                    </ActionButton>
                  ) : (
                    <ActionButton
                      action={setInquiryStatusAction}
                      fields={{ inquiryId: row.id, status: "NEW" }}
                      variant="ghost"
                      pendingLabel="Saving…"
                    >
                      Reopen
                    </ActionButton>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState title={status ? "No enquiries with that status" : "No enquiries yet"}>
          Messages sent from the website&apos;s Contact page appear here.
        </EmptyState>
      )}
    </>
  );
}
