import { WalletIcon } from "lucide-react";
import type { Metadata, Route } from "next";

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
import { toDateInput, today } from "@/lib/dates";
import { listFeeHeads, listFeePositions, readStudentFees, suggestReceiptNo } from "@/server/finance/fees";
import { StudentCharges } from "@/features/finance/student-charges";

export const metadata: Metadata = { title: "Collect fees" };

/**
 * The fee desk for staff with "Collect fees" — or, with "Fee dashboard" only,
 * the same screen read-only. With "Fee structure & charges" (the Accountant's
 * default) the desk also adds a fee to the student in front of them — so a
 * family that walks in to pay a fee not yet charged can be charged and then
 * collected from on the same screen — and removes a wrong charge.
 * "Give fee concessions" adds the concession buttons. The School Admin keeps
 * all of it.
 */
export default async function StaffFeesPage(props: PageProps<"/staff/fees">) {
  const ctx = await requireTenant("NON_TEACHING_STAFF");
  await requireStaffModule(ctx, ["fees.view", "fees.collect", "fees.manage"]);
  // "fees.view" alone: the same desk, read-only — find a student, see what they owe.
  const [canCollect, canManage, canConcession, canReport] = await Promise.all([
    staffHolds(ctx, "fees.collect"),
    staffHolds(ctx, "fees.manage"),
    staffHolds(ctx, "fees.concessions"),
    staffHolds(ctx, "fees.reports"),
  ]);
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
  const [account, heads, previous] = selected
    ? await Promise.all([
        readStudentFees(ctx, selected.studentId, session.id),
        canManage ? listFeeHeads(ctx) : Promise.resolve([]),
        previousDues(ctx, selected.studentId),
      ])
    : [null, [], []];

  return (
    <>
      <PageHeader
        icon={WalletIcon}
        tone="orange"
        title={canCollect ? "Collect fees" : "Fees"}
        description={canCollect ? `${session.name} · take a payment and print the receipt` : `${session.name} · pending fees and payment history`}
        actions={
          canCollect || canManage || canReport ? (
            <>
              {canReport ? (
                <Button asChild variant="outline">
                  <Link href={"/staff/fees/reports" as Route}>Fee reports</Link>
                </Button>
              ) : null}
              {canManage ? (
                <Button asChild variant="outline">
                  <Link href="/staff/fees/structure">Fee structure &amp; charges</Link>
                </Button>
              ) : null}
              {canCollect ? (
                <Button asChild variant="outline">
                  <Link href="/staff/fees/family">Family payment</Link>
                </Button>
              ) : null}
            </>
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
        {selected && account && canManage ? (
          <StudentCharges
            studentId={selected.studentId}
            studentName={selected.name}
            charges={account.charges}
            status={account.summary.status}
            heads={heads.filter((head) => head.isActive).map((head) => ({ value: head.id, label: head.name }))}
            canManage
            defaultDueOn={toDateInput(today())}
          />
        ) : null}
        {selected && account ? (
          <StudentFeeAccount
              ledgerHref={`/staff/fees/ledger/${selected.studentId}`}
            studentId={selected.studentId}
            account={account}
            previous={previous}
            canManage={false}
            canConcession={canConcession}
            canCarryForward={canManage}
          />
        ) : null}
      </div>
    </>
  );
}
