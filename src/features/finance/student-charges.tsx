import { ActionButton } from "@/components/forms/action-button";
import type { SelectOption } from "@/components/forms/fields";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { removeChargeAction } from "@/features/finance/actions";
import { ChargeStudentForm } from "@/features/finance/forms";
import { FEE_STATUS_LABEL, FEE_STATUS_TONE, rupees } from "@/features/finance/money";
import { formatDate } from "@/lib/dates";

type Charge = { id: string; amountMinor: number; dueOn: Date; feeHead: { name: string } };

/**
 * One student's fees this session, at the fee desk: what has been charged,
 * and — with "Fee structure & charges" — add a fee for this student (a family
 * that walks in to pay something not yet billed) or remove a wrong one. The
 * School Admin and the accountant use the same card; the server checks again.
 */
export function StudentCharges({
  studentId,
  studentName,
  charges,
  status,
  heads,
  canManage,
  defaultDueOn,
}: {
  studentId: string;
  studentName: string;
  charges: Charge[];
  status: string;
  heads: SelectOption[];
  canManage: boolean;
  defaultDueOn: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle>{studentName} — fees charged</CardTitle>
          <CardDescription>{canManage ? "Add a fee for this student before taking the payment, or remove one charged by mistake." : "What has been charged this session."}</CardDescription>
        </div>
        <StatusBadge status={status} label={FEE_STATUS_LABEL[status as keyof typeof FEE_STATUS_LABEL]} tone={FEE_STATUS_TONE[status as keyof typeof FEE_STATUS_TONE]} />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {charges.length ? (
          <ul className="divide-y">
            {charges.map((charge) => (
              <li key={charge.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 text-sm">
                  <span className="font-medium">{charge.feeHead.name}</span>
                  <span className="text-muted-foreground block text-xs">due {formatDate(charge.dueOn)}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-sm tabular-nums">{rupees(charge.amountMinor)}</span>
                  {canManage ? (
                    <ActionButton
                      action={removeChargeAction}
                      fields={{ chargeId: charge.id }}
                      variant="ghost"
                      size="xs"
                      pendingLabel="Removing…"
                      confirm={{
                        title: `Remove ${charge.feeHead.name} from ${studentName}?`,
                        description: "The family's total fee and pending amount go down by this much. Payments already recorded are not touched.",
                        confirmLabel: "Remove",
                      }}
                    >
                      Remove
                    </ActionButton>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">Nothing charged yet this session.</p>
        )}
        {canManage ? (
          heads.length ? (
            <details className="rounded-lg border p-3" open={!charges.length}>
              <summary className="cursor-pointer text-sm font-medium">Add a fee for this student</summary>
              <div className="mt-3">
                <ChargeStudentForm studentId={studentId} heads={heads} defaultDueOn={defaultDueOn} />
              </div>
            </details>
          ) : (
            <p className="text-muted-foreground text-sm">Add a fee head (Tuition, Transport…) under Fee structure first.</p>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}
