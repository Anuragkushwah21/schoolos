import type { Route } from "next";
import Link from "next/link";
import { BarChart3Icon, DownloadIcon } from "lucide-react";

import { ActionButton } from "@/components/forms/action-button";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/dates";
import type { TenantContext } from "@/server/auth/current-user";
import { classFeeSummary, overdueInstallments, sessionFeeSummary } from "@/server/finance/fee-reports";
import { lateFeePolicy } from "@/server/finance/late-fees";

import { applyLateFeesAction } from "./actions";
import { LateFeePolicyForm } from "./forms";
import { rupees } from "./money";

function Money({ minor, strong = false }: { minor: number; strong?: boolean }) {
  return <td className={`px-3 py-2 text-right tabular-nums ${strong ? "font-semibold" : ""}`}>{rupees(minor)}</td>;
}

/**
 * Fee reports: class-wise and session-wise totals, overdue instalments with
 * ageing, and the late-fee policy — for the School Admin and fee staff.
 * Every figure is worked out from the charge, concession and payment rows
 * (server/finance/fee-reports.ts); each report also downloads as CSV.
 */
export async function FeeReportsScreen({ ctx, exportBase, canApplyLateFees, canSetPolicy }: { ctx: TenantContext; exportBase: string; canApplyLateFees: boolean; canSetPolicy: boolean }) {
  const [byClass, bySession, overdue, policy] = await Promise.all([classFeeSummary(ctx), sessionFeeSummary(ctx), overdueInstallments(ctx), lateFeePolicy(ctx)]);
  const csv = (kind: string) => `${exportBase}?kind=${kind}` as Route;
  const total = byClass.total;
  return (
    <>
      <PageHeader icon={BarChart3Icon} tone="green" title="Fee reports" description={`${byClass.session.name} · assigned, collected, pending and overdue — worked out from every charge, concession and receipt.`} />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard tone="blue" label="Assigned" value={rupees(total.assignedMinor)} hint={`${rupees(total.concessionMinor)} in concessions`} />
        <StatCard tone="green" label="Collected" value={rupees(total.paidMinor)} hint={`of ${rupees(total.chargedMinor)} due`} />
        <StatCard tone="amber" label="Pending" value={rupees(total.pendingMinor)} hint={`${total.students} students`} />
        <StatCard tone="red" label="Overdue" value={rupees(overdue.totalMinor)} hint={`${overdue.rows.length} instalments`} />
      </div>

      <Card className="mb-6">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>By class</CardTitle>
            <CardDescription>Net due is after concessions. Overdue counts instalments past their due date, after payments are applied earliest-first.</CardDescription>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href={csv("fees-class")} prefetch={false}>
              <DownloadIcon className="size-4" aria-hidden />
              CSV
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-muted-foreground text-xs">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Class</th>
                <th className="px-3 py-2 text-right font-medium">Students</th>
                <th className="px-3 py-2 text-right font-medium">Assigned</th>
                <th className="px-3 py-2 text-right font-medium">Concessions</th>
                <th className="px-3 py-2 text-right font-medium">Net due</th>
                <th className="px-3 py-2 text-right font-medium">Collected</th>
                <th className="px-3 py-2 text-right font-medium">Pending</th>
                <th className="px-3 py-2 text-right font-medium">Overdue</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {byClass.rows.map((row) => (
                <tr key={row.section}>
                  <td className="px-3 py-2 font-medium">{row.section}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.students}</td>
                  <Money minor={row.assignedMinor} />
                  <Money minor={row.concessionMinor} />
                  <Money minor={row.chargedMinor} />
                  <Money minor={row.paidMinor} />
                  <Money minor={row.pendingMinor} />
                  <Money minor={row.overdueMinor} />
                </tr>
              ))}
              <tr className="bg-muted/40">
                <td className="px-3 py-2 font-semibold">Total</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{total.students}</td>
                <Money minor={total.assignedMinor} strong />
                <Money minor={total.concessionMinor} strong />
                <Money minor={total.chargedMinor} strong />
                <Money minor={total.paidMinor} strong />
                <Money minor={total.pendingMinor} strong />
                <Money minor={total.overdueMinor} strong />
              </tr>
            </tbody>
          </table>
          {byClass.rows.length ? null : <p className="text-muted-foreground mt-3 text-sm">No fees charged this session yet.</p>}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>Overdue instalments</CardTitle>
            <CardDescription>{`0–30 days ${rupees(overdue.buckets["0-30"])} · 31–60 ${rupees(overdue.buckets["31-60"])} · 61–90 ${rupees(overdue.buckets["61-90"])} · over 90 ${rupees(overdue.buckets["90+"])}`}</CardDescription>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href={csv("fees-overdue")} prefetch={false}>
              <DownloadIcon className="size-4" aria-hidden />
              CSV
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {overdue.rows.length ? (
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-muted-foreground text-xs">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Student</th>
                  <th className="px-3 py-2 text-left font-medium">Class</th>
                  <th className="px-3 py-2 text-left font-medium">Fee</th>
                  <th className="px-3 py-2 text-left font-medium">Due on</th>
                  <th className="px-3 py-2 text-right font-medium">Days</th>
                  <th className="px-3 py-2 text-right font-medium">Unpaid</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {overdue.rows.slice(0, 200).map((row) => (
                  <tr key={row.chargeId}>
                    <td className="px-3 py-2">
                      <span className="font-medium">{row.name}</span>
                      <span className="text-muted-foreground block text-xs">{row.admissionNumber}</span>
                    </td>
                    <td className="px-3 py-2">{row.section}</td>
                    <td className="px-3 py-2">{`${row.head}${row.installments > 1 && !row.isLateFee ? ` · instalment ${row.installmentNo} of ${row.installments}` : ""}`}</td>
                    <td className="px-3 py-2 tabular-nums">{formatDate(row.dueOn)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <StatusBadge status={row.bucket} tone={row.days > 60 ? "negative" : "warning"} label={`${row.days}`} />
                    </td>
                    <Money minor={row.remainingMinor} />
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-muted-foreground text-sm">Nothing is overdue.</p>
          )}
          {overdue.rows.length > 200 ? <p className="text-muted-foreground mt-2 text-xs">{`Showing the oldest 200 of ${overdue.rows.length}. The CSV has them all.`}</p> : null}
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle>By session</CardTitle>
            <Button asChild variant="outline" size="sm">
              <Link href={csv("fees-sessions")} prefetch={false}>
                <DownloadIcon className="size-4" aria-hidden />
                CSV
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground text-xs">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Session</th>
                  <th className="px-3 py-2 text-right font-medium">Net due</th>
                  <th className="px-3 py-2 text-right font-medium">Collected</th>
                  <th className="px-3 py-2 text-right font-medium">Pending</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {bySession.map((row) => (
                  <tr key={row.id}>
                    <td className="px-3 py-2 font-medium">{row.isCurrent ? `${row.name} (current)` : row.name}</td>
                    <Money minor={row.chargedMinor} />
                    <Money minor={row.paidMinor} />
                    <Money minor={row.pendingMinor} />
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Late fees</CardTitle>
            <CardDescription>{policy.amountMinor ? `${rupees(policy.amountMinor)} once per instalment unpaid ${policy.graceDays} day(s) after its due date. Nothing is added automatically — apply it when you are ready; applying again adds nothing twice.` : "Switched off."}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {canSetPolicy ? <LateFeePolicyForm amountRupees={policy.amountMinor / 100} graceDays={policy.graceDays} /> : null}
            {canApplyLateFees && policy.amountMinor ? (
              <div>
                <ActionButton action={applyLateFeesAction} fields={{}} confirm={{ title: "Apply late fees now?", description: "Each overdue instalment past the grace period gets one late-fee charge the family will see. Instalments that already have one are skipped.", confirmLabel: "Apply late fees" }}>
                  Apply late fees
                </ActionButton>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
