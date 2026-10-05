import type { Route } from "next";
import Link from "next/link";
import { UsersIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { rupees } from "@/features/finance/money";
import { formatDate, today, toDateInput } from "@/lib/dates";
import type { TenantContext } from "@/server/auth/current-user";
import { familiesWithSiblings, familyFees, getFamilyReceipt } from "@/server/finance/family";

import { FamilyPaymentForm, FamilyPaymentSwitch, VoidFamilyPaymentForm } from "./family-forms";
import { FamilyFeesView } from "./family-views";

/**
 * The fee desk for a family with several children: pick the parent, see each
 * child's fees and the family total, and take one payment split per child.
 * Shared by the School Admin and staff who hold "Collect fees".
 */
export async function FamilyDesk({ ctx, base, parentId }: { ctx: TenantContext; base: "/school-admin/finance/family" | "/staff/fees/family"; parentId?: string }) {
  const admin = ctx.user.role === "SCHOOL_ADMIN";
  const [families, school] = await Promise.all([familiesWithSiblings(ctx), ctx.db.school.findFirst({ select: { familyPaymentEnabled: true } })]);
  const enabled = school?.familyPaymentEnabled ?? false;
  const family = parentId ? await familyFees(ctx, parentId) : null;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Family payments <StatusBadge status={enabled ? "ACTIVE" : "INACTIVE"} label={enabled ? "On" : "Off"} />
          </CardTitle>
          <CardDescription>
            One payment for several brothers and sisters, recorded as a separate receipt for each child under one family receipt.
            {admin ? "" : " The School Admin switches this on or off."}
          </CardDescription>
        </CardHeader>
        {admin ? (
          <CardContent>
            <FamilyPaymentSwitch enabled={enabled} />
          </CardContent>
        ) : null}
      </Card>

      <FilterBar
        action={base}
        selects={[{ name: "parent", label: "Family (parent with 2+ children)", defaultValue: parentId, allLabel: "Choose a family…", options: families }]}
      />

      {!family ? (
        <EmptyState icon={UsersIcon} tone="orange" title={families.length ? "Choose a family" : "No families with more than one child yet"}>
          A parent with two or more current children at the school appears in the list above.
        </EmptyState>
      ) : (
        <>
          <FamilyFeesView family={family} />
          <Card>
            <CardHeader>
              <CardTitle>Take one family payment</CardTitle>
              <CardDescription>Amounts are this session&apos;s pending fees. Earlier sessions are paid after carrying them forward.</CardDescription>
            </CardHeader>
            <CardContent>
              {enabled ? (
                <FamilyPaymentForm
                  parentId={family.parent.id}
                  childrenDue={family.children.map((child) => ({ id: child.id, name: child.name, pendingMinor: child.summary.pendingMinor }))}
                  today={toDateInput(today())}
                  back={base}
                />
              ) : (
                <p className="text-muted-foreground text-sm">Family payments are off. Take each child&apos;s payment separately from the fee desk.</p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

/** A family receipt: which amount went to which child, each with its own receipt. */
export async function FamilyReceiptView({ ctx, familyPaymentId, back }: { ctx: TenantContext; familyPaymentId: string; back: string }) {
  const receipt = await getFamilyReceipt(ctx, familyPaymentId);
  return (
    <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Family receipt <span className="font-mono">{receipt.receiptNo}</span>
            {receipt.voidedAt ? <StatusBadge status="VOID" tone="negative" label="Void" /> : null}
          </CardTitle>
          <CardDescription>
            {receipt.parent.name} · {receipt.parent.phone} · {formatDate(receipt.paidOn)} · {receipt.method.replace("_", " ").toLowerCase()}
            {receipt.referenceNo ? ` · ref ${receipt.referenceNo}` : ""} · {receipt.academicSession.name}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead className="text-muted-foreground text-left text-xs uppercase">
              <tr>
                <th className="py-2">Child</th>
                <th className="py-2">Receipt</th>
                <th className="py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {receipt.parts.map((part) => (
                <tr key={part.id} className="border-t">
                  <td className="py-2">
                    {part.student} <span className="text-muted-foreground text-xs">({part.admissionNumber})</span>
                  </td>
                  <td className="py-2">
                    <Link href={`/receipts/${part.id}` as Route} target="_blank" className="font-mono text-xs hover:underline">
                      {part.receiptNo}
                    </Link>
                  </td>
                  <td className="py-2 text-right tabular-nums">{rupees(part.amountMinor)}</td>
                </tr>
              ))}
              <tr className="border-t font-semibold">
                <td className="py-2" colSpan={2}>
                  Total received
                </td>
                <td className="py-2 text-right tabular-nums">{rupees(receipt.totalMinor)}</td>
              </tr>
            </tbody>
          </table>
          <Button asChild variant="outline" size="sm" className="mt-4">
            <Link href={back as Route}>Back</Link>
          </Button>
        </CardContent>
      </Card>
      {ctx.user.role === "SCHOOL_ADMIN" && !receipt.voidedAt ? (
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Void</CardTitle>
            <CardDescription>Voids every child&apos;s share together, so no account is left half-paid.</CardDescription>
          </CardHeader>
          <CardContent>
            <VoidFamilyPaymentForm familyPaymentId={receipt.id} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
