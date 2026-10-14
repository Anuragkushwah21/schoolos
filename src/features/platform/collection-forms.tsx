"use client";

import { useState } from "react";

import { ActionForm, type FormAction } from "@/components/forms/action-form";
import { FieldRow, SelectField, SubmitButton, TextField, TextareaField } from "@/components/forms/fields";
import { formatMoney } from "@/lib/format";

import { createPlatformBillAction, recordPlatformPaymentAction } from "./actions";

const METHOD_OPTIONS = [
  { value: "UPI", label: "UPI" },
  { value: "BANK_TRANSFER", label: "Bank transfer" },
  { value: "CASH", label: "Cash" },
  { value: "CHEQUE", label: "Cheque" },
  { value: "CARD", label: "Card" },
  { value: "OTHER", label: "Other" },
];

export type BillableOrganization = { id: string; name: string; campuses: number; planName: string | null; suggestedMinor: number | null };

/**
 * Raise a bill to an organization. The amount starts from what its plan's
 * price comes to for its campuses (when the plan has a price) — a
 * suggestion the Super Admin may change. Nothing is charged: the bill only
 * shows as pending until money is recorded against it.
 */
export function NewBillForm({ organizations, defaultDueOn }: { organizations: BillableOrganization[]; defaultDueOn: string }) {
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id ?? "");
  const chosen = organizations.find((org) => org.id === organizationId);
  const [amount, setAmount] = useState(chosen?.suggestedMinor ? String(chosen.suggestedMinor / 100) : "");
  return (
    <ActionForm action={createPlatformBillAction} className="gap-4" resetOnSuccess>
      <SelectField
        name="organizationId"
        label="Organization"
        value={organizationId}
        onChange={(event) => {
          setOrganizationId(event.target.value);
          const next = organizations.find((org) => org.id === event.target.value);
          setAmount(next?.suggestedMinor ? String(next.suggestedMinor / 100) : "");
        }}
        options={organizations.map((org) => ({ value: org.id, label: `${org.name} — ${org.planName ?? "no plan"} · ${org.campuses === 1 ? "1 campus" : `${org.campuses} campuses`}` }))}
        required
      />
      <FieldRow>
        <TextField
          name="amount"
          label="Amount (₹)"
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          hint={chosen?.suggestedMinor ? `Plan price for these campuses: ${formatMoney(chosen.suggestedMinor)}` : "The plan has no set price — enter the agreed amount."}
          required
        />
        <TextField name="dueOn" label="Due on" type="date" defaultValue={defaultDueOn} required />
      </FieldRow>
      <FieldRow>
        <TextField name="periodStart" label="Period from (optional)" type="date" />
        <TextField name="periodEnd" label="Period to (optional)" type="date" />
      </FieldRow>
      <TextField name="description" label="Description (optional)" placeholder="e.g. Pro plan, 2026–27" />
      <div>
        <SubmitButton pendingLabel="Creating…">Create bill</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** Money received against one bill. One submission records one payment, even if pressed twice. */
export function RecordPaymentForm({ billId, pendingMinor, today }: { billId: string; pendingMinor: number; today: string }) {
  const [idempotencyKey] = useState(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`));
  return (
    <ActionForm action={recordPlatformPaymentAction} className="gap-3">
      <input type="hidden" name="billId" value={billId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <FieldRow>
        <TextField name="amount" label="Amount received (₹)" inputMode="decimal" defaultValue={pendingMinor / 100} hint={`Still due: ${formatMoney(pendingMinor)}`} required />
        <TextField name="receivedOn" label="Received on" type="date" defaultValue={today} max={today} required />
      </FieldRow>
      <FieldRow>
        <SelectField name="method" label="How" options={METHOD_OPTIONS} defaultValue="UPI" required />
        <TextField name="referenceNo" label="Reference (UTR, cheque no.)" />
      </FieldRow>
      <TextField name="notes" label="Note (optional)" />
      <div>
        <SubmitButton size="sm" pendingLabel="Saving…">
          Record payment
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

/** A reason, then the action (void a payment, cancel a bill). */
export function ReasonActionForm({ action, id, label, hint }: { action: FormAction<undefined>; id: string; label: string; hint: string }) {
  return (
    <ActionForm action={action} className="gap-2">
      <input type="hidden" name="id" value={id} />
      <TextareaField name="reason" label="Reason" hint={hint} rows={2} required />
      <div>
        <SubmitButton size="sm" variant="destructive" pendingLabel="Saving…">
          {label}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
