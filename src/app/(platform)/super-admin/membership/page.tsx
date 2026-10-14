import type { Metadata, Route } from "next";
import { CreditCardIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { ViewTabs } from "@/components/shared/view-tabs";
import { MembershipTable } from "@/features/platform/membership-table";
import { enumParam } from "@/lib/search-params";
import { requireSuperAdmin } from "@/server/auth/current-user";
import { listMemberships } from "@/server/platform/membership";

export const metadata: Metadata = { title: "Membership" };

const FILTERS = ["ended", "soon", "overdue", "open"] as const;

/**
 * Every organization's membership (plan or trial) with its end date, soonest
 * first, and a reminder for one school or many. Billing is manual: nothing
 * here takes or records a payment.
 */
export default async function MembershipPage(props: PageProps<"/super-admin/membership">) {
  const user = await requireSuperAdmin();
  const search = await props.searchParams;
  const filter = enumParam(search.show, FILTERS) ?? "all";
  const { rows, counts } = await listMemberships(user, filter);
  const tab = (value: (typeof FILTERS)[number] | null, label: string, count: number) => ({
    href: (value ? `/super-admin/membership?show=${value}` : "/super-admin/membership") as Route,
    label,
    count,
    active: (filter === "all" ? null : filter) === value,
  });

  return (
    <>
      <PageHeader
        icon={CreditCardIcon}
        tone="purple"
        title="Membership"
        description="Whose plan or trial ends when, soonest first. Send a reminder to one school or tick several. SchoolOS does not take online payments — a reminder asks the school to contact you; it changes no subscription."
      />
      <div className="mb-4">
        <ViewTabs
          label="Memberships"
          tabs={[tab(null, "All", counts.all), tab("ended", "Ended", counts.ended), tab("soon", "Ending in 30 days", counts.soon), tab("overdue", "Payment overdue", counts.overdue), tab("open", "No end date", counts.open)]}
        />
      </div>
      {rows.length ? (
        <MembershipTable
          rows={rows.map((row) => ({ key: row.key, title: row.title, href: row.href, detail: row.detail, status: row.status, schoolId: row.schoolIds[0]!, endsOn: row.endsOn, daysLeft: row.daysLeft, lastRemindedAt: row.lastRemindedAt, lastReminderDelivered: row.lastReminderDelivered }))}
        />
      ) : (
        <EmptyState title="Nothing here">No membership matches this view.</EmptyState>
      )}
    </>
  );
}
