import { ActionButton } from "@/components/forms/action-button";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { rupees } from "@/features/finance/money";
import { formatDate } from "@/lib/dates";
import type { PreviousDue } from "@/server/finance/carry-forward";
import type { familyFees } from "@/server/finance/family";
import type { readStudentFees } from "@/server/finance/fees";

import { carryForwardAction, revokeConcessionAction } from "./family-actions";
import { ConcessionForm } from "./family-forms";

type Account = Awaited<ReturnType<typeof readStudentFees>>;

/**
 * One student's fee account at the desk: each head with its original amount,
 * any concession and the net; what is paid and pending; and earlier sessions
 * still owed — with "Carry forward outstanding" for the School Admin.
 */
export function StudentFeeAccount({
  studentId,
  account,
  previous,
  canManage,
  canConcession = canManage,
  canCarryForward = canManage,
  ledgerHref,
}: {
  /** The student's ledger page (running balance), when the reader may open it. */
  ledgerHref?: string;
  studentId: string;
  account: Account;
  previous: PreviousDue[];
  /** Both of the below (the School Admin). */
  canManage: boolean;
  /** Give or withdraw a concession ("Give fee concessions"). */
  canConcession?: boolean;
  /** Carry forward an old session's dues ("Fee structure & charges"). */
  canCarryForward?: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Fee account{account.session ? ` · ${account.session.name}` : ""}</CardTitle>
        <CardDescription>A concession takes money off a fee without changing the fee itself; every change is kept.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {account.charges.length ? (
          <ul className="divide-y rounded-xl border text-sm">
            {account.charges.map((charge) => (
              <li key={charge.id} className="flex flex-col gap-2 px-3 py-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">
                    {charge.feeHead.name}
                    {charge.installmentNo > 1 || account.charges.some((other) => other.id !== charge.id && other.feeHead.id === charge.feeHead.id) ? <span className="text-muted-foreground font-normal">{` · instalment ${charge.installmentNo}`}</span> : null}
                    <span className="text-muted-foreground block text-xs font-normal">
                      {`Due ${formatDate(charge.dueOn)}`}
                      {charge.status === "PARTIAL" ? ` · ${rupees(charge.remainingMinor)} still to pay` : ""}
                    </span>
                    {charge.carriedFrom ? <span className="text-muted-foreground block text-xs">Carried forward from {charge.carriedFrom.name}</span> : null}
                  </span>
                  <InstallmentBadge status={charge.status} overdue={charge.overdue} />
                  <span className="tabular-nums">
                    {charge.discountMinor ? (
                      <>
                        <span className="text-muted-foreground line-through">{rupees(charge.originalMinor)}</span>{" "}
                        <span className="text-success-strong">−{rupees(charge.discountMinor)}</span>{" "}
                      </>
                    ) : null}
                    <strong>{rupees(charge.netMinor)}</strong>
                  </span>
                </div>
                {charge.concession ? (
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <StatusBadge status="CONCESSION" tone="positive" label={charge.concession.kind === "PERCENT" ? `${charge.concession.value / 100}% concession` : "Concession"} />
                    <span className="text-muted-foreground">
                      {charge.concession.reason}
                      {charge.concession.approvedBy ? ` · approved by ${charge.concession.approvedBy.firstName} ${charge.concession.approvedBy.lastName}` : ""}
                    </span>
                    {canConcession ? (
                      <ActionButton action={revokeConcessionAction} fields={{ concessionId: charge.concession.id }} variant="ghost" size="xs" confirm={{ title: "Withdraw this concession?", description: "The full fee applies again. The concession stays in the history.", confirmLabel: "Withdraw" }}>
                        Withdraw
                      </ActionButton>
                    ) : null}
                  </div>
                ) : null}
                {canConcession && !charge.carriedFrom ? (
                  <details className="text-xs">
                    <summary className="text-muted-foreground cursor-pointer">{charge.concession ? "Change concession" : "Give a concession"}</summary>
                    <div className="mt-2">
                      <ConcessionForm chargeId={charge.id} originalMinor={charge.originalMinor} />
                    </div>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">No fees charged this session.</p>
        )}

        {ledgerHref ? (
          <a className="text-primary text-sm font-medium hover:underline" href={ledgerHref}>
            Open ledger (every charge, concession and payment with the running balance)
          </a>
        ) : null}
        <dl className="grid grid-cols-3 gap-2 text-sm">
          <div>
            <dt className="text-muted-foreground text-xs">Net fees</dt>
            <dd className="font-semibold tabular-nums">{rupees(account.summary.chargedMinor)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Paid</dt>
            <dd className="font-semibold tabular-nums">{rupees(account.summary.paidMinor)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Pending</dt>
            <dd className="font-semibold tabular-nums">{rupees(account.summary.pendingMinor)}</dd>
          </div>
        </dl>

        {previous.length ? (
          <div className="border-warning/40 bg-warning-soft/40 flex flex-col gap-2 rounded-xl border p-3 text-sm">
            <p className="font-semibold">Previous sessions still owed</p>
            {previous.map((due) => (
              <div key={due.sessionId} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {due.sessionName}: <strong className="tabular-nums">{rupees(due.pendingMinor)}</strong>
                </span>
                {canCarryForward ? (
                  <ActionButton
                    action={carryForwardAction}
                    fields={{ studentId, fromSessionId: due.sessionId }}
                    variant="outline"
                    confirm={{
                      title: `Carry forward ${rupees(due.pendingMinor)}?`,
                      description: `Adds "Previous outstanding (${due.sessionName})" to this session's fees, linked to ${due.sessionName}. The old session then shows it as carried forward.`,
                      confirmLabel: "Carry forward outstanding",
                    }}
                  >
                    Carry forward outstanding
                  </ActionButton>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

type Family = Awaited<ReturnType<typeof familyFees>>;

/** Each child's fees, separately — then the family's total. */
export function FamilyFeesView({ family }: { family: Family }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 lg:grid-cols-2">
        {family.children.map((child) => (
          <Card key={child.id}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center justify-between gap-2">
                {child.name}
                <StatusBadge status={child.summary.status} />
              </CardTitle>
              <CardDescription>
                {child.section ?? "Not placed"} · {child.admissionNumber}
                {child.session ? ` · ${child.session.name}` : ""}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              {child.charges.length ? (
                <table className="w-full">
                  <tbody>
                    {child.charges.map((charge) => (
                      <tr key={charge.id} className="border-b last:border-0">
                        <td className="py-1.5">
                          {charge.head}
                          {charge.carriedFrom ? <span className="text-muted-foreground block text-xs">Unpaid from {charge.carriedFrom}</span> : null}
                          {charge.concessionReason ? <span className="text-success-strong block text-xs">Concession: {charge.concessionReason}</span> : null}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">
                          {charge.discountMinor ? (
                            <span className="text-muted-foreground mr-1 text-xs line-through">{rupees(charge.originalMinor)}</span>
                          ) : null}
                          {rupees(charge.netMinor)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-muted-foreground">No fees charged yet.</p>
              )}
              <dl className="grid grid-cols-3 gap-2">
                <div>
                  <dt className="text-muted-foreground text-xs">Fees</dt>
                  <dd className="tabular-nums">{rupees(child.summary.chargedMinor)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Paid</dt>
                  <dd className="tabular-nums">{rupees(child.summary.paidMinor)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Pending</dt>
                  <dd className="font-semibold tabular-nums">{rupees(child.summary.pendingMinor)}</dd>
                </div>
              </dl>
              {child.summary.dueOn && child.summary.pendingMinor ? (
                <p className={child.summary.overdue ? "text-danger-strong text-xs" : "text-muted-foreground text-xs"}>
                  {child.summary.overdue ? "Overdue since" : "Due by"} {formatDate(child.summary.dueOn)}
                </p>
              ) : null}
              {child.previous.map((due) => (
                <p key={due.sessionId} className="border-warning/40 bg-warning-soft/50 rounded-lg border px-3 py-2 text-xs">
                  Previous outstanding from {due.sessionName}: <strong className="tabular-nums">{rupees(due.pendingMinor)}</strong> — still owed from last session.
                </p>
              ))}
              {child.previous.length ? (
                <p className="text-sm">
                  Total payable for {child.name.split(" ")[0]}: <strong className="tabular-nums">{rupees(child.payableMinor)}</strong>
                </p>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
      {family.children.length > 1 ? (
        <Card className="ring-primary/30 ring-2">
          <CardHeader>
            <CardTitle>Family total</CardTitle>
            <CardDescription>All your children at this school, together. Each child&apos;s account stays separate.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-muted-foreground text-xs">Fees this session</dt>
                <dd className="font-semibold tabular-nums">{rupees(family.totals.chargedMinor)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Paid</dt>
                <dd className="font-semibold tabular-nums">{rupees(family.totals.paidMinor)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Previous outstanding</dt>
                <dd className="font-semibold tabular-nums">{rupees(family.totals.previousMinor)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Family total payable</dt>
                <dd className="text-primary-strong text-lg font-extrabold tabular-nums">{rupees(family.totals.payableMinor)}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

/** Paid / Part paid / Due / Overdue for one instalment, as the office and parents see it. */
export function InstallmentBadge({ status, overdue }: { status: "PAID" | "PARTIAL" | "DUE"; overdue: boolean }) {
  if (status === "PAID") return <StatusBadge status="PAID" tone="positive" label="Paid" />;
  if (overdue) return <StatusBadge status="OVERDUE" tone="negative" label={status === "PARTIAL" ? "Part paid · overdue" : "Overdue"} />;
  return <StatusBadge status={status} tone="warning" label={status === "PARTIAL" ? "Part paid" : "Due"} />;
}
