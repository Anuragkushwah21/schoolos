"use client";

import { useState } from "react";

import { ActionForm } from "@/components/forms/action-form";
import {
  FieldRow,
  SelectField,
  type SelectOption,
  SubmitButton,
  TextField,
  TextareaField,
} from "@/components/forms/fields";

import {
  chargeSectionAction,
  chargeStudentAction,
  createFeeHeadAction,
  paySalaryAction,
  recordExpenseAction,
  recordPaymentAction,
  removePaymentAction,
  saveLateFeePolicyAction,
  saveReceiptSettingsAction,
  setSalaryAction,
} from "./actions";
import { EXPENSE_CATEGORY_OPTIONS } from "./money";

/**
 * The forms behind the school's money.
 *
 * Amounts are typed in rupees and converted to paise by the schema before they
 * reach the database, so nothing here does arithmetic on money and no float is
 * ever stored. The fields are plain numbers because that is what a person types.
 */

const SALARY_TYPE_OPTIONS = [
  { value: "MONTHLY", label: "Per month" },
  { value: "ANNUAL", label: "Per year" },
  { value: "HOURLY", label: "Per hour" },
];

const METHOD_OPTIONS = [
  { value: "CASH", label: "Cash" },
  { value: "UPI", label: "UPI" },
  { value: "BANK_TRANSFER", label: "Bank transfer" },
  { value: "CHEQUE", label: "Cheque" },
  { value: "CARD", label: "Card" },
  { value: "OTHER", label: "Other" },
];

export function SalaryForm({
  teacherId,
  staffMemberId,
  today,
  current,
}: {
  /** One of the two: whose salary this is. */
  teacherId?: string;
  staffMemberId?: string;
  today: string;
  /** Prefilled from the figure in force, so a raise is an edit of one number. */
  current?: {
    salaryType: string;
    amountRupees: string;
    allowancesRupees: string;
    deductionsRupees: string;
  };
}) {
  return (
    <ActionForm action={setSalaryAction}>
      {teacherId ? <input type="hidden" name="teacherId" value={teacherId} /> : null}
      {staffMemberId ? <input type="hidden" name="staffMemberId" value={staffMemberId} /> : null}
      <FieldRow>
        <TextField
          name="amountMinor"
          label="Salary (₹)"
          type="number"
          min={1}
          step="1"
          defaultValue={current?.amountRupees}
          required
        />
        <SelectField
          name="salaryType"
          label="Paid"
          options={SALARY_TYPE_OPTIONS}
          defaultValue={current?.salaryType ?? "MONTHLY"}
          required
        />
      </FieldRow>
      <FieldRow>
        <TextField
          name="allowancesMinor"
          label="Allowances (₹)"
          type="number"
          min={0}
          step="1"
          defaultValue={current?.allowancesRupees ?? "0"}
          hint="Travel, housing — anything added every month."
        />
        <TextField
          name="deductionsMinor"
          label="Deductions (₹)"
          type="number"
          min={0}
          step="1"
          defaultValue={current?.deductionsRupees ?? "0"}
          hint="Provident fund, professional tax."
        />
      </FieldRow>
      <TextField
        name="effectiveFrom"
        label="Effective from"
        type="date"
        defaultValue={today}
        hint="A new date keeps the old figure as history. The same date corrects it."
        required
      />
      <TextareaField name="notes" label="Note" rows={2} />
      <div>
        <SubmitButton pendingLabel="Saving…">Save salary</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function FeeHeadForm() {
  return (
    <ActionForm action={createFeeHeadAction} resetOnSuccess className="gap-3">
      <FieldRow>
        <TextField name="name" label="Fee head" placeholder="Tuition fee" required />
        <TextField name="note" label="Note" placeholder="Shown to parents" />
      </FieldRow>
      <div>
        <SubmitButton variant="outline" pendingLabel="Adding…">
          Add fee head
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

/** Raise one head against a whole section — how a school actually bills. */
export function ChargeSectionForm({
  sections,
  heads,
  defaultDueOn,
}: {
  sections: SelectOption[];
  heads: SelectOption[];
  defaultDueOn: string;
}) {
  return (
    <ActionForm action={chargeSectionAction} resetOnSuccess>
      <FieldRow>
        <SelectField name="sectionId" label="Class" options={sections} placeholder="Choose…" required />
        <SelectField name="feeHeadId" label="Fee head" options={heads} placeholder="Choose…" required />
      </FieldRow>
      <FieldRow>
        <TextField name="amountMinor" label="Amount per student (₹)" type="number" min={1} step="1" required />
        <TextField name="dueOn" label="Due on" type="date" defaultValue={defaultDueOn} required />
      </FieldRow>
      <FieldRow>
        <SelectField name="installmentCount" label="Pay in" options={INSTALLMENT_OPTIONS} defaultValue="1" hint="Split equally; the first instalment is due on the date above." />
        <SelectField name="installmentEveryMonths" label="Instalments every" options={EVERY_OPTIONS} defaultValue="1" />
      </FieldRow>
      <div>
        <SubmitButton pendingLabel="Charging…">Charge the class</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** One charge on one student, for when a family's amount differs. */
export function ChargeStudentForm({
  studentId,
  heads,
  defaultDueOn,
}: {
  studentId: string;
  heads: SelectOption[];
  defaultDueOn: string;
}) {
  return (
    <ActionForm action={chargeStudentAction} resetOnSuccess className="gap-3">
      <input type="hidden" name="studentId" value={studentId} />
      <FieldRow>
        <SelectField name="feeHeadId" label="Fee head" options={heads} placeholder="Choose…" required />
        <TextField name="amountMinor" label="Amount (₹)" type="number" min={1} step="1" required />
      </FieldRow>
      <FieldRow>
        <TextField name="dueOn" label="Due on" type="date" defaultValue={defaultDueOn} required />
        <TextField name="notes" label="Note" />
      </FieldRow>
      <FieldRow>
        <SelectField name="installmentCount" label="Pay in" options={INSTALLMENT_OPTIONS} defaultValue="1" hint="Split equally; the first instalment is due on the date above." />
        <SelectField name="installmentEveryMonths" label="Instalments every" options={EVERY_OPTIONS} defaultValue="1" />
      </FieldRow>
      <div>
        <SubmitButton variant="outline" pendingLabel="Saving…">
          Add charge
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export function PaymentForm({
  studentId,
  today,
  suggestedReceiptNo,
}: {
  studentId: string;
  today: string;
  suggestedReceiptNo: string;
}) {
  const [idempotencyKey] = useState(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`));
  return (
    <ActionForm action={recordPaymentAction} resetOnSuccess className="gap-3">
      <input type="hidden" name="studentId" value={studentId} />
      {/* One key per form: pressing twice, or a retried request, records one payment. */}
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <FieldRow>
        <TextField name="amountMinor" label="Amount received (₹)" type="number" min={1} step="1" required />
        <TextField name="paidOn" label="Paid on" type="date" defaultValue={today} max={today} required />
      </FieldRow>
      <FieldRow>
        <SelectField name="method" label="Method" options={METHOD_OPTIONS} defaultValue="CASH" required />
        <TextField
          name="receiptNo"
          label="Receipt number"
          defaultValue={suggestedReceiptNo}
          hint="Unique within your school. Printed on the receipt."
          required
        />
      </FieldRow>
      <TextField
        name="referenceNo"
        label="Reference no."
        hint="Cheque number, UPI or bank transaction id — printed on the receipt."
      />
      <TextField name="notes" label="Note" />
      <div>
        <SubmitButton pendingLabel="Recording payment…">Record payment</SubmitButton>
      </div>
    </ActionForm>
  );
}


const INSTALLMENT_OPTIONS = [1, 2, 3, 4, 6, 12].map((n) => ({ value: String(n), label: n === 1 ? "One payment" : `${n} instalments` }));
const EVERY_OPTIONS = [1, 2, 3, 4, 6].map((n) => ({ value: String(n), label: n === 1 ? "Every month" : `Every ${n} months` }));

/** Void a receipt — always with the reason, which prints on the receipt and goes on the audit log. */
export function VoidPaymentForm({ paymentId, receiptNo }: { paymentId: string; receiptNo: string }) {
  return (
    <details className="inline-block text-left">
      <summary className="text-muted-foreground hover:text-foreground cursor-pointer px-2 text-xs">Void…</summary>
      <ActionForm action={removePaymentAction} className="bg-card absolute right-4 z-10 mt-1 w-72 gap-2 rounded-lg border p-3 shadow-lg">
        <input type="hidden" name="paymentId" value={paymentId} />
        <p className="text-xs">{`Receipt ${receiptNo} stays on record marked VOID; the family's balance goes back up.`}</p>
        <TextField name="reason" label="Why" placeholder="Entered twice, wrong student…" minLength={3} required />
        <SubmitButton size="sm" variant="destructive" pendingLabel="Voiding…">
          Void receipt
        </SubmitButton>
      </ActionForm>
    </details>
  );
}

export function ExpenseForm({ today, defaultCategory }: { today: string; defaultCategory?: string | null }) {
  return (
    <ActionForm action={recordExpenseAction} resetOnSuccess className="gap-3">
      <FieldRow>
        <SelectField
          name="category"
          label="Category"
          options={EXPENSE_CATEGORY_OPTIONS}
          placeholder="Choose a category"
          defaultValue={defaultCategory ?? undefined}
          hint={defaultCategory === "EQUIPMENT" ? "A purchase for the school — a computer, projector, lab item…" : undefined}
          required
        />
        <TextField name="amountMinor" label="Amount (₹)" type="number" min={1} step="1" required />
      </FieldRow>
      <TextField name="description" label="What it was for" placeholder="September electricity bill" required />
      <FieldRow>
        <TextField name="spentOn" label="Spent on" type="date" defaultValue={today} max={today} required />
        <SelectField name="method" label="Method" options={METHOD_OPTIONS} defaultValue="CASH" required />
      </FieldRow>
      <TextField name="reference" label="Bill / voucher number" />
      <div>
        <SubmitButton pendingLabel="Saving expense…">Add expense</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function SalaryPaymentForm({
  people,
  today,
}: {
  /** Teachers and staff; each value is "T:<teacherId>" or "S:<staffMemberId>". */
  people: SelectOption[];
  today: string;
}) {
  return (
    <ActionForm action={paySalaryAction} resetOnSuccess className="gap-3">
      <SelectField
        name="payee"
        label="Teacher or staff member"
        options={people}
        placeholder={people.length ? "Choose who was paid" : "No active teachers or staff"}
        disabled={!people.length}
        required
      />
      <FieldRow>
        <TextField name="amountMinor" label="Amount paid (₹)" type="number" min={1} step="1" required />
        <TextField name="forMonth" label="For month" type="month" defaultValue={today.slice(0, 7)} required />
      </FieldRow>
      <FieldRow>
        <TextField name="paidOn" label="Paid on" type="date" defaultValue={today} max={today} required />
        <SelectField name="method" label="Method" options={METHOD_OPTIONS} defaultValue="BANK_TRANSFER" required />
      </FieldRow>
      <TextField name="reference" label="Transaction reference" />
      <div>
        <SubmitButton pendingLabel="Saving…">Record salary payment</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** What this school prints on its fee receipts, beyond its name and address. */
export function ReceiptSettingsForm({
  settings,
}: {
  settings: { receiptHeaderNote: string | null; receiptFooterNote: string | null };
}) {
  return (
    <ActionForm action={saveReceiptSettingsAction} className="max-w-3xl">
      <TextField
        name="receiptHeaderNote"
        label="Header line"
        defaultValue={settings.receiptHeaderNote ?? ""}
        placeholder="Affiliated to CBSE, New Delhi · Affiliation No. 1234567"
        hint="Printed under the school name, e.g. affiliation or registration number."
      />
      <TextareaField
        name="receiptFooterNote"
        label="Footer note"
        rows={3}
        defaultValue={settings.receiptFooterNote ?? ""}
        placeholder="Fees once paid are not refundable. Please keep this receipt safe."
        hint="Printed at the bottom of every receipt."
      />
      <div>
        <SubmitButton>Save receipt settings</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** School Admin: the late-fee policy. */
export function LateFeePolicyForm({ amountRupees, graceDays }: { amountRupees: number; graceDays: number }) {
  return (
    <ActionForm action={saveLateFeePolicyAction} className="gap-3">
      <FieldRow>
        <TextField name="amountMinor" label="Late fee per overdue instalment (₹)" type="number" min={0} step="1" defaultValue={amountRupees} hint="0 switches late fees off." />
        <TextField name="graceDays" label="Days after the due date" type="number" min={0} max={365} step="1" defaultValue={graceDays} />
      </FieldRow>
      <div>
        <SubmitButton variant="outline" pendingLabel="Saving…">
          Save late fee policy
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
