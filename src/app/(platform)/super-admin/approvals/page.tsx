import type { Metadata, Route } from "next";
import Link from "next/link";
import { CheckCircle2Icon, ClipboardCheckIcon, MailWarningIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/dates";
import { requireSuperAdmin } from "@/server/auth/current-user";
import { listPendingSchools } from "@/server/platform/schools";

export const metadata: Metadata = { title: "Approvals" };

/**
 * Schools waiting for a decision, oldest first, with what they submitted.
 * Approving opens the school's review — plan, features, then approve —
 * because a plan has to be chosen and the details checked first.
 */
export default async function ApprovalsPage() {
  const user = await requireSuperAdmin();
  const schools = await listPendingSchools(user);

  return (
    <>
      <PageHeader icon={ClipboardCheckIcon} tone="amber" title="Pending approval" description="Review each school's details, choose its plan and features, then approve — or reject with a reason." />
      {schools.length ? (
        <ul className="flex flex-col gap-3">
          {schools.map((school) => {
            const admin = school.users[0];
            const href = (hash = "") => `/super-admin/schools/${school.id}${hash}` as Route;
            return (
              <li key={school.id} className="bg-card shadow-card flex flex-col gap-3 rounded-2xl border p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={href()} className="text-base font-semibold hover:underline">
                      {school.name}
                    </Link>
                    <p className="text-muted-foreground text-xs">{[school.slug, school.udiseCode ? `UDISE ${school.udiseCode}` : null].filter(Boolean).join(" · ")}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <StatusBadge status={school.status} />
                    {school.contactEmailVerifiedAt ? (
                      <StatusBadge status="ACTIVE" label="Email verified" tone="positive" />
                    ) : (
                      <StatusBadge status="PENDING" label="Email not verified" tone="warning" />
                    )}
                  </div>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
                  {[
                    ["Location", [school.city, school.state].filter(Boolean).join(", ") || "—"],
                    ["Registered", formatDate(school.createdAt)],
                    ["Contact person", `${school.contactName} · ${school.contactPhone}`],
                    ["School admin", admin ? `${admin.firstName} ${admin.lastName}` : `${school.contactName} (created on approval)`],
                    ["Requested plan", school.subscriptions[0]?.plan.name ?? "None chosen"],
                    ["Board", school.affiliationBoard ?? "—"],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-muted-foreground text-xs">{label}</dt>
                      <dd className="break-words">{value}</dd>
                    </div>
                  ))}
                </dl>
                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="outline" size="sm">
                    <Link href={href()}>Review</Link>
                  </Button>
                  {school.contactEmailVerifiedAt ? (
                    <Button asChild size="sm" className="bg-success hover:bg-success/90 bg-none text-white shadow-none">
                      <Link href={href("#approve")}>
                        <CheckCircle2Icon aria-hidden />
                        Approve
                      </Link>
                    </Button>
                  ) : (
                    <Button asChild variant="outline" size="sm">
                      <Link href={href()}>
                        <MailWarningIcon aria-hidden />
                        Verify email first
                      </Link>
                    </Button>
                  )}
                  <Button asChild variant="destructive" size="sm">
                    <Link href={href("#reject")}>Reject</Link>
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState icon={CheckCircle2Icon} tone="green" title="Nothing waiting">
          Every registration has been decided. New ones appear here as schools register.
        </EmptyState>
      )}
      <p className="text-muted-foreground mt-4 text-xs">
        The registration form asks for the school, its location and contact, the board and the plan. Student and class numbers are not collected at registration; they appear on the school once it is running.
      </p>
    </>
  );
}
