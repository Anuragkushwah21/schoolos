import type { Route } from "next";
import Link from "next/link";
import { HeartPulseIcon } from "lucide-react";

import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import type { TenantContext } from "@/server/auth/current-user";
import { needsAttention } from "@/server/exams/attention";

/**
 * On a student's page (teacher or office): each subject they need attention
 * in, the latest result, and the reason in words. Nothing shows when there is
 * nothing to act on — the student is not labelled.
 */
export async function StudentAttentionCard({ ctx, studentId, supportBase }: { ctx: TenantContext; studentId: string; supportBase: "/school-admin/support" | "/teacher/support" }) {
  const { rows, rule } = await needsAttention(ctx, { studentIds: [studentId] });
  if (!rows.length) return null;
  return (
    <section aria-label="Needs attention" className="border-warning/40 bg-warning-soft/40 mb-6 rounded-2xl border p-4 sm:p-5">
      <h2 className="mb-1 flex items-center gap-2 font-semibold">
        <HeartPulseIcon className="text-warning-strong size-5" aria-hidden />
        Needs attention
      </h2>
      <p className="text-muted-foreground mb-3 text-xs">{rule}</p>
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li key={row.subjectId} className="bg-card flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2.5 text-sm">
            <span className="min-w-0 flex-1">
              <span className="font-semibold">{row.subject}</span> <StatusBadge status="NEEDS_ATTENTION" label="Needs attention" tone="warning" />
              <span className="text-muted-foreground block text-xs">
                {row.latestPercent !== null ? `Latest test: ${row.latestPercent}% (${row.latestTest}) · ` : ""}
                Reason: {row.reasons.map((reason) => reason.text).join("; ")}
              </span>
            </span>
            <Button asChild size="sm" variant={row.supportId ? "outline" : "default"}>
              <Link href={(row.supportId ? `${supportBase}/${row.supportId}` : `${supportBase}/new?student=${row.studentId}&subject=${row.subjectId}`) as Route}>
                {row.supportId ? "View support" : "Start support"}
              </Link>
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
