import { WalletIcon } from "lucide-react";
import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { SetupNotice } from "@/components/shared/setup-notice";
import { FeeDesk } from "@/features/finance/fee-desk";
import { param } from "@/lib/search-params";
import { getCurrentSession } from "@/server/academics/structure";
import { requireTenant } from "@/server/auth/current-user";
import { requireStaffModule } from "@/server/auth/staff-access";
import { listFeePositions, readStudentFees, suggestReceiptNo } from "@/server/finance/fees";

export const metadata: Metadata = { title: "Collect fees" };

/**
 * The fee desk for a staff member the School Admin allowed to collect fees.
 * Taking payments and printing receipts only — charging fees, voiding
 * receipts, expenses and salaries stay with the School Admin.
 */
export default async function StaffFeesPage(props: PageProps<"/staff/fees">) {
  const ctx = await requireTenant("NON_TEACHING_STAFF");
  await requireStaffModule(ctx, "COLLECT_FEES");
  const session = await getCurrentSession(ctx);
  if (!session) return <SetupNotice title="Collect fees" need="session" />;

  const search = await props.searchParams;
  const q = param(search.q);
  const studentId = param(search.student);
  const receiptId = param(search.receipt);

  const [positions, receiptNo, justRecorded] = await Promise.all([
    listFeePositions(ctx, { q }),
    suggestReceiptNo(ctx),
    receiptId
      ? ctx.db.feePayment.findFirst({ where: { id: receiptId }, select: { id: true, receiptNo: true, amountMinor: true } })
      : Promise.resolve(null),
  ]);
  const selected =
    positions.rows.find((row) => row.studentId === studentId) ?? (q && positions.rows.length === 1 ? positions.rows[0] : null);
  const account = selected ? await readStudentFees(ctx, selected.studentId, session.id) : null;

  return (
    <>
      <PageHeader icon={WalletIcon} tone="orange" title="Collect fees" description={`${session.name} · take a payment and print the receipt`} />
      <div className="max-w-2xl">
        <FeeDesk
          basePath="/staff/fees"
          q={q}
          positions={positions.rows}
          selected={selected}
          account={account}
          receiptNo={receiptNo}
          justRecorded={justRecorded}
        />
      </div>
    </>
  );
}
