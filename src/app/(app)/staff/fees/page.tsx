import { WalletIcon } from "lucide-react";
import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { SetupNotice } from "@/components/shared/setup-notice";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { FeeDesk } from "@/features/finance/fee-desk";
import { StudentFeeAccount } from "@/features/finance/family-views";
import { previousDues } from "@/server/finance/carry-forward";
import { param } from "@/lib/search-params";
import { getCurrentSession } from "@/server/academics/structure";
import { requireTenant } from "@/server/auth/current-user";
import { requireStaffModule, staffHolds } from "@/server/auth/staff-access";
import { listFeePositions, readStudentFees, suggestReceiptNo } from "@/server/finance/fees";

export const metadata: Metadata = { title: "Collect fees" };

/**
 * The fee desk for staff with "Collect fees" — or, with "Fee dashboard" only,
 * the same screen read-only.
 * Taking payments and printing receipts only — charging fees, voiding
 * receipts, expenses and salaries stay with the School Admin.
 */
export default async function StaffFeesPage(props: PageProps<"/staff/fees">) {
  const ctx = await requireTenant("NON_TEACHING_STAFF");
  await requireStaffModule(ctx, ["fees.view", "fees.collect"]);
  // "fees.view" alone: the same desk, read-only — find a student, see what they owe.
  const canCollect = await staffHolds(ctx, "fees.collect");
  const session = await getCurrentSession(ctx);
  if (!session) return <SetupNotice title="Collect fees" need="session" />;

  const search = await props.searchParams;
  const q = param(search.q);
  const studentId = param(search.student);
  const receiptId = param(search.receipt);

  const [positions, receiptNo, justRecorded] = await Promise.all([
    listFeePositions(ctx, { q }),
    canCollect ? suggestReceiptNo(ctx) : Promise.resolve(""),
    receiptId
      ? ctx.db.feePayment.findFirst({ where: { id: receiptId }, select: { id: true, receiptNo: true, amountMinor: true } })
      : Promise.resolve(null),
  ]);
  const selected =
    positions.rows.find((row) => row.studentId === studentId) ?? (q && positions.rows.length === 1 ? positions.rows[0] : null);
  const account = selected ? await readStudentFees(ctx, selected.studentId, session.id) : null;

  return (
    <>
      <PageHeader
        icon={WalletIcon}
        tone="orange"
        title={canCollect ? "Collect fees" : "Fees"}
        description={canCollect ? `${session.name} · take a payment and print the receipt` : `${session.name} · pending fees and payment history`}
        actions={
          canCollect ? (
            <Button asChild variant="outline">
              <Link href="/staff/fees/family">Family payment</Link>
            </Button>
          ) : undefined
        }
      />
      <div className="flex max-w-2xl flex-col gap-6">
        <FeeDesk
          basePath="/staff/fees"
          q={q}
          positions={positions.rows}
          selected={selected}
          account={account}
          receiptNo={receiptNo}
          justRecorded={justRecorded}
          canCollect={canCollect}
        />
        {selected && account ? <StudentFeeAccount studentId={selected.studentId} account={account} previous={await previousDues(ctx, selected.studentId)} canManage={false} /> : null}
      </div>
    </>
  );
}
