import { ClipboardCheckIcon } from "lucide-react";
import type { Metadata } from "next";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate, formatDayShort } from "@/lib/dates";
import { requireTenant } from "@/server/auth/current-user";
import { myStaffAttendance } from "@/server/staff/portal";

export const metadata: Metadata = { title: "My attendance" };

const TONE = { PRESENT: "positive", LATE: "warning", ABSENT: "negative", ON_LEAVE: "info" } as const;
const LABEL = { PRESENT: "Present", LATE: "Late", ABSENT: "Absent", ON_LEAVE: "On leave" } as const;

/** A staff member's own register, as the school office marked it. */
export default async function StaffAttendancePage() {
  const ctx = await requireTenant("NON_TEACHING_STAFF");
  const { from, to, rows, counts } = await myStaffAttendance(ctx);

  return (
    <>
      <PageHeader icon={ClipboardCheckIcon} tone="green" title="My attendance" description={`${formatDate(from)} – ${formatDate(to)} · marked by the school office`} />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(Object.keys(LABEL) as Array<keyof typeof LABEL>).map((status) => (
          <div key={status} className="rounded-xl border p-4">
            <p className="text-muted-foreground text-xs">{LABEL[status]}</p>
            <p className="text-2xl font-semibold tabular-nums">{counts[status]}</p>
          </div>
        ))}
      </div>
      {rows.length ? (
        <Card className="max-w-2xl">
          <CardContent className="pt-6">
            <ul className="divide-y text-sm">
              {rows.map((row) => (
                <li key={row.date.toISOString()} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="min-w-0 flex-1">
                    {formatDayShort(row.date)}
                    {row.remarks ? <span className="text-muted-foreground block text-xs">{row.remarks}</span> : null}
                  </span>
                  <StatusBadge status={row.status} tone={TONE[row.status]} label={LABEL[row.status]} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : (
        <EmptyState title="Nothing marked in the last 30 days" />
      )}
    </>
  );
}
