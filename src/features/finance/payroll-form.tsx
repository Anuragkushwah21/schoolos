"use client";

import { ActionForm, useFormContext } from "@/components/forms/action-form";
import { FieldRow, SelectField, SubmitButton, TextField } from "@/components/forms/fields";
import { FieldError } from "@/components/shared/field-error";
import { StatusBadge } from "@/components/shared/status-badge";
import { Input } from "@/components/ui/input";

import { payPayrollAction } from "./actions";
import { rupees, toRupeeInput } from "./money";

type Row = {
  teacherId: string;
  name: string;
  employeeId: string;
  designation: string | null;
  structure: { salaryType: string; baseMinor: number; allowancesMinor: number; deductionsMinor: number } | null;
  dueMinor: number | null;
  unpaidLeaveDays: number;
  payment: { amountMinor: number; paidOn: string; method: string } | null;
};

const METHODS = [
  { value: "BANK_TRANSFER", label: "Bank transfer" },
  { value: "CASH", label: "Cash" },
  { value: "UPI", label: "UPI" },
  { value: "CHEQUE", label: "Cheque" },
  { value: "OTHER", label: "Other" },
];

function PayrollRow({ row }: { row: Row }) {
  const { fieldErrors } = useFormContext();
  const errors = fieldErrors?.[`amount:${row.teacherId}`];
  return (
    <tr className="border-t align-top">
      <td className="px-3 py-2">
        {row.payment ? null : (
          <input
            type="checkbox"
            name="pay"
            value={row.teacherId}
            defaultChecked={row.dueMinor !== null}
            aria-label={`Pay ${row.name}`}
            className="accent-primary size-4"
          />
        )}
      </td>
      <td className="px-3 py-2">
        <span className="font-medium">{row.name}</span>
        <span className="text-muted-foreground block text-xs">
          {row.employeeId}
          {row.designation ? ` · ${row.designation}` : ""}
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
          </span>
        ) : (
          <>
            <Input
              name={`amount:${row.teacherId}`}
              aria-label={`Amount for ${row.name}`}
              inputMode="decimal"
              defaultValue={row.dueMinor !== null ? toRupeeInput(row.dueMinor) : ""}
              placeholder="₹"
              className="w-32"
            />
            <FieldError id={`amount-${row.teacherId}-error`} messages={errors} />
          </>
        )}
      </td>
    </tr>
  );
}

export function PayrollForm({ month, today, rows }: { month: string; today: string; rows: Row[] }) {
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
              <th className="px-3 py-2 font-medium">Teacher</th>
              <th className="px-3 py-2 font-medium">Structure (base + allowances − deductions)</th>
              <th className="px-3 py-2 font-medium">Leave</th>
              <th className="px-3 py-2 font-medium">Amount (₹)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <PayrollRow key={row.teacherId} row={row} />
            ))}
          </tbody>
        </table>
      </div>
      {unpaid ? (
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
