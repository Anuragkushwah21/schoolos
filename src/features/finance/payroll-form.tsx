"use client";

import { ActionForm, useFormContext } from "@/components/forms/action-form";
import { FieldRow, SelectField, SubmitButton, TextField } from "@/components/forms/fields";
import { FieldError } from "@/components/shared/field-error";
import { StatusBadge } from "@/components/shared/status-badge";
import { Input } from "@/components/ui/input";

import { payPayrollAction } from "./actions";
import { rupees, toRupeeInput } from "./money";

type Row = {
  /** "T:<teacherId>" or "S:<staffMemberId>". */
  key: string;
  /** "Teacher", or the staff role. */
  role: string;
  name: string;
  employeeId: string;
  designation: string | null;
  structure: { salaryType: string; baseMinor: number; allowancesMinor: number; deductionsMinor: number } | null;
  dueMinor: number | null;
  unpaidLeaveDays: number;
  payment: { amountMinor: number; paidOn: string; method: string; paidBy: string | null } | null;
};

const METHODS = [
  { value: "BANK_TRANSFER", label: "Bank transfer" },
  { value: "CASH", label: "Cash" },
  { value: "UPI", label: "UPI" },
  { value: "CHEQUE", label: "Cheque" },
  { value: "OTHER", label: "Other" },
];

function PayrollRow({ row, readOnly }: { row: Row; readOnly: boolean }) {
  const { fieldErrors } = useFormContext();
  const errors = fieldErrors?.[`amount:${row.key}`];
  return (
    <tr className="border-t align-top">
      <td className="px-3 py-2">
        {row.payment || readOnly ? null : (
          <input
            type="checkbox"
            name="pay"
            value={row.key}
            defaultChecked={row.dueMinor !== null}
            aria-label={`Pay ${row.name}`}
            className="accent-primary size-4"
          />
        )}
      </td>
      <td className="px-3 py-2">
        <span className="font-medium">{row.name}</span>
        <span className="text-muted-foreground block text-xs">
          {row.employeeId} · {row.role}
          {row.designation && row.designation !== row.role ? ` · ${row.designation}` : ""}
        </span>
      </td>
      <td className="text-muted-foreground px-3 py-2 text-xs tabular-nums">
        {row.structure ? (
          <>
            {rupees(row.structure.baseMinor)} + {rupees(row.structure.allowancesMinor)} − {rupees(row.structure.deductionsMinor)}
            <span className="block">{row.structure.salaryType.toLowerCase()}</span>
          </>
        ) : (
          "No salary set"
        )}
      </td>
      <td className="px-3 py-2 text-xs tabular-nums">{row.unpaidLeaveDays ? `${row.unpaidLeaveDays} unpaid leave days` : "—"}</td>
      <td className="px-3 py-2">
        {row.payment ? (
          <span className="flex flex-col gap-1">
            <span className="tabular-nums">{rupees(row.payment.amountMinor)}</span>
            <StatusBadge status="PAID" label={`Paid ${row.payment.paidOn}`} tone="positive" />
            {row.payment.paidBy ? <span className="text-muted-foreground block text-xs">{`by ${row.payment.paidBy}`}</span> : null}
          </span>
        ) : readOnly ? (
          <span className="text-muted-foreground tabular-nums">{row.dueMinor !== null ? `${rupees(row.dueMinor)} due` : "—"}</span>
        ) : (
          <>
            <Input
              name={`amount:${row.key}`}
              aria-label={`Amount for ${row.name}`}
              inputMode="decimal"
              defaultValue={row.dueMinor !== null ? toRupeeInput(row.dueMinor) : ""}
              placeholder="₹"
              className="w-32"
            />
            <FieldError id={`amount-${row.key.replace(":", "-")}-error`} messages={errors} />
          </>
        )}
      </td>
    </tr>
  );
}

/** `readOnly` for staff who may view payroll but not pay it: no selection, amounts or pay button. */
export function PayrollForm({ month, today, rows, readOnly = false }: { month: string; today: string; rows: Row[]; readOnly?: boolean }) {
  const unpaid = rows.filter((row) => !row.payment).length;
  return (
    <ActionForm action={payPayrollAction}>
      <input type="hidden" name="month" value={month} />
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[48rem] text-sm">
          <thead className="bg-muted/40 text-left">
            <tr>
              <th className="w-10 px-3 py-2">
                <span className="sr-only">Select</span>
              </th>
              <th className="px-3 py-2 font-medium">Teacher / staff</th>
              <th className="px-3 py-2 font-medium">Structure (base + allowances − deductions)</th>
              <th className="px-3 py-2 font-medium">Leave</th>
              <th className="px-3 py-2 font-medium">Amount (₹)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <PayrollRow key={row.key} row={row} readOnly={readOnly} />
            ))}
          </tbody>
        </table>
      </div>
      {unpaid && !readOnly ? (
        <>
          <FieldRow>
            <TextField name="paidOn" label="Paid on" type="date" defaultValue={today} max={today} required />
            <SelectField name="method" label="Method" options={METHODS} defaultValue="BANK_TRANSFER" required />
          </FieldRow>
          <TextField name="reference" label="Reference" hint="Bank batch or cheque number, if any." />
          <div>
            <SubmitButton pendingLabel="Recording…">Mark selected as paid</SubmitButton>
          </div>
        </>
      ) : null}
    </ActionForm>
  );
}
