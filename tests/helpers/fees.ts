import { addDays, today } from "@/lib/dates";
import type { TenantContext } from "@/server/auth/current-user";
import { chargeStudent, createFeeHead } from "@/server/finance/fees";

/**
 * Give a student something to pay: a payment is only taken against a fee
 * (fees.ts refuses more than is outstanding).
 */
export async function owe(admin: TenantContext, studentId: string, amountMinor: number, name = `Test fee ${Math.random().toString(36).slice(2, 8)}`) {
  const head = await createFeeHead(admin, { name, note: null });
  await chargeStudent(admin, { studentId, feeHeadId: head.id, amountMinor, dueOn: addDays(today(), 30), notes: null });
  return head.id;
}
