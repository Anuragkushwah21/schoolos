import type { Metadata, Route } from "next";
import Link from "next/link";
import { BadgeIndianRupeeIcon } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApplyConcessionsForm } from "@/features/admissions/enquiry-panels";
import { rupees } from "@/features/finance/money";
import { formatDate } from "@/lib/dates";
import { concessionPlan } from "@/server/admissions/enquiries";
import { requireTenant } from "@/server/auth/current-user";
import { orNotFound } from "@/server/page-helpers";

export const metadata: Metadata = { title: "Apply agreed discount" };

/**
 * The step from a discussion to real money, and the only one: for each
 * admitted child, what was agreed and which of their own fees it goes on.
 * Nothing is written until the office confirms.
 */
export default async function ApplyDiscountPage(props: PageProps<"/school-admin/admissions/enquiries/[enquiryId]/fees">) {
  const ctx = await requireTenant("SCHOOL_ADMIN", "PRINCIPAL");
  const { enquiryId } = await props.params;
  const { enquiry, rows } = await orNotFound(concessionPlan(ctx, enquiryId));
  const pending = rows.filter((row) => row.discussed && !row.appliedAt && row.agreedDiscountMinor > 0);
  const ready = pending.filter((row) => row.charges.length);
  const noFees = pending.filter((row) => !row.charges.length);
  const done = rows.filter((row) => row.appliedAt);
  const total = pending.reduce((sum, row) => sum + row.agreedFinalMinor, 0);

  return (
    <>
      <PageHeader
        back={{ href: `/school-admin/admissions/enquiries/${enquiry.id}` as Route, label: enquiry.enquiryNumber }}
        icon={BadgeIndianRupeeIcon}
        tone="green"
        title="Apply discussed discount to actual fee records?"
        description={`${enquiry.parentName} · ${pending.length} ${pending.length === 1 ? "child" : "children"} admitted with an agreed discount not yet applied.`}
      />

      <div className="flex max-w-4xl flex-col gap-6">
        {pending.length ? (
          <Card>
            <CardHeader>
              <CardTitle>
                {pending.length} {pending.length === 1 ? "child" : "children"} selected
              </CardTitle>
              <CardDescription>Each child&apos;s agreed figure: their own discount plus their share of the family discount.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="divide-y text-sm">
                {pending.map((row) => (
                  <li key={row.childId} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                    <span>
                      <strong>{row.name}</strong> · {row.className}
                    </span>
                    <span className="tabular-nums">
                      {rupees(row.originalMinor)} − {rupees(row.childDiscountMinor)}
                      {row.familyShareMinor ? ` − ${rupees(row.familyShareMinor)} family` : ""} = <strong>{rupees(row.agreedFinalMinor)}</strong>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-sm">
                Family discussion total: <strong className="tabular-nums">{rupees(total)}</strong> — a summary only. Every concession is made on one child&apos;s own fee.
              </p>
            </CardContent>
          </Card>
        ) : (
          <p className="text-muted-foreground">Nothing to apply: no admitted child has an agreed discount waiting.</p>
        )}

        {noFees.length ? (
          <Card className="border-warning/50">
            <CardHeader>
              <CardTitle>Charge fees first</CardTitle>
              <CardDescription>
                {noFees.map((row) => row.name).join(", ")} {noFees.length === 1 ? "has" : "have"} no fees this session yet, so there is nothing to put a concession on. Charge the fees, then come back.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {noFees.map((row) =>
                row.student ? (
                  <Button key={row.childId} asChild size="sm" variant="outline">
                    <Link href={`/school-admin/finance/payments?student=${row.student.id}` as Route}>Fees for {row.name}</Link>
                  </Button>
                ) : null,
              )}
            </CardContent>
          </Card>
        ) : null}

        {ready.length ? (
          <ApplyConcessionsForm
            enquiryId={enquiry.id}
            rows={ready.map((row) => ({ childId: row.childId, name: row.name, className: row.className, agreedDiscountMinor: row.agreedDiscountMinor, charges: row.charges, suggestedChargeId: row.suggestedChargeId }))}
          />
        ) : null}

        {done.length ? (
          <p className="text-muted-foreground text-sm">Already applied: {done.map((row) => `${row.name} (${formatDate(row.appliedAt!)})`).join(", ")}.</p>
        ) : null}

        <div>
          <Button asChild variant="outline">
            <Link href={`/school-admin/admissions/enquiries/${enquiry.id}` as Route}>Cancel</Link>
          </Button>
        </div>
      </div>
    </>
  );
}
