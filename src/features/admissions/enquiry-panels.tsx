"use client";

import { useState } from "react";

import { ActionForm } from "@/components/forms/action-form";
import { CheckboxField, FieldRow, type SelectOption, SelectField, SubmitButton, TextField, TextareaField } from "@/components/forms/fields";
import { rupees } from "@/features/finance/money";
import { DISCOUNT_REASONS, type DiscountKind, discountMinorFor, discountProblem, rupeesToMinor } from "@/lib/fee-discussion";

import { addEnquiryFollowUpAction, applyConcessionsAction, saveChildFeeAction, saveFamilyFeeAction, setEnquiryStatusAction } from "./enquiry-actions";

const DISCOUNT_OPTIONS: SelectOption[] = [
  { value: "NONE", label: "No discount" },
  { value: "FIXED", label: "Fixed amount (₹)" },
  { value: "PERCENT", label: "Percentage (%)" },
];

/** Stored value (paise / basis points) back to what the form shows (rupees / percent). */
const typedValue = (kind: DiscountKind, value: number) => (kind === "NONE" || !value ? "" : String(value / 100));

function Reasons() {
  return (
    <datalist id="discount-reasons">
      {DISCOUNT_REASONS.map((reason) => (
        <option key={reason} value={reason} />
      ))}
    </datalist>
  );
}

/** Edit one child's discussed fee. The live line shows original − discount = final before saving. */
export function ChildFeeForm({ childId, defaults }: { childId: string; defaults: { feeOriginalMinor: number | null; discountKind: DiscountKind; discountValue: number; discountReason: string | null; feeNotes: string | null } }) {
  const [fee, setFee] = useState(defaults.feeOriginalMinor !== null ? String(defaults.feeOriginalMinor / 100) : "");
  const [kind, setKind] = useState<DiscountKind>(defaults.discountKind);
  const [value, setValue] = useState(typedValue(defaults.discountKind, defaults.discountValue));
  const original = rupeesToMinor(fee);
  const stored = Math.round(Number(value || 0) * 100);
  const problem = original !== null ? discountProblem(original, kind, stored) : null;
  const discount = original !== null && !problem ? discountMinorFor(original, kind, stored) : 0;
  return (
    <ActionForm action={saveChildFeeAction} className="gap-4">
      <input type="hidden" name="childId" value={childId} />
      <Reasons />
      <FieldRow>
        <TextField name="feeOriginal" label="Discussed fee (₹)" inputMode="decimal" required value={fee} onChange={(event) => setFee(event.target.value)} />
        <SelectField name="discountKind" label="Discount" options={DISCOUNT_OPTIONS} value={kind} onChange={(event) => { setKind(event.target.value as DiscountKind); setValue(""); }} />
      </FieldRow>
      {kind !== "NONE" ? (
        <FieldRow>
          <TextField name="discountValue" label={kind === "PERCENT" ? "Discount (%)" : "Discount (₹)"} inputMode="decimal" required value={value} onChange={(event) => setValue(event.target.value)} />
          <TextField name="discountReason" label="Reason" list="discount-reasons" defaultValue={defaults.discountReason ?? ""} />
        </FieldRow>
      ) : null}
      <TextareaField name="feeNotes" label="Notes (internal)" rows={2} defaultValue={defaults.feeNotes ?? ""} />
      {original !== null ? (
        <p className={problem ? "text-danger-strong text-sm" : "bg-success-soft/60 rounded-lg px-3 py-2 text-sm tabular-nums"}>
          {problem ?? (
            <>
              {rupees(original)} − {rupees(discount)} = <strong>{rupees(original - discount)}</strong>
            </>
          )}
        </p>
      ) : null}
      <div>
        <SubmitButton size="sm">Save fee discussion</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** The family / sibling discount, on what is left after each child's own discount. */
export function FamilyFeeForm({
  enquiryId,
  subtotalMinor,
  defaults,
}: {
  enquiryId: string;
  subtotalMinor: number;
  defaults: { kind: DiscountKind; value: number; reason: string | null; notes: string | null; status: string };
}) {
  const [kind, setKind] = useState<DiscountKind>(defaults.kind);
  const [value, setValue] = useState(typedValue(defaults.kind, defaults.value));
  const stored = Math.round(Number(value || 0) * 100);
  const problem = kind !== "NONE" && subtotalMinor ? discountProblem(subtotalMinor, kind, stored) : null;
  const discount = !problem ? discountMinorFor(subtotalMinor, kind, stored) : 0;
  return (
    <ActionForm action={saveFamilyFeeAction} className="gap-4">
      <input type="hidden" name="enquiryId" value={enquiryId} />
      <Reasons />
      <FieldRow>
        <SelectField name="familyDiscountKind" label="Family / sibling discount" options={DISCOUNT_OPTIONS} value={kind} onChange={(event) => { setKind(event.target.value as DiscountKind); setValue(""); }} />
        {kind !== "NONE" ? <TextField name="familyDiscountValue" label={kind === "PERCENT" ? "Discount (%)" : "Discount (₹)"} inputMode="decimal" required value={value} onChange={(event) => setValue(event.target.value)} /> : <div />}
      </FieldRow>
      {kind !== "NONE" ? <TextField name="familyDiscountReason" label="Reason" list="discount-reasons" defaultValue={defaults.reason ?? "Sibling admission"} /> : null}
      <TextareaField name="discussionNotes" label="Discussion notes (internal)" rows={3} defaultValue={defaults.notes ?? ""} hint="Never shown publicly." />
      <SelectField
        name="feeStatus"
        label="Fee discussion status"
        defaultValue={defaults.status === "NOT_STARTED" ? "DISCUSSING" : defaults.status}
        options={[
          { value: "DISCUSSING", label: "Still discussing" },
          { value: "AGREED", label: "Agreed with the family" },
        ]}
      />
      {kind !== "NONE" && subtotalMinor ? (
        <p className={problem ? "text-danger-strong text-sm" : "bg-success-soft/60 rounded-lg px-3 py-2 text-sm tabular-nums"}>
          {problem ?? (
            <>
              {rupees(subtotalMinor)} − {rupees(discount)} family discount = <strong>{rupees(subtotalMinor - discount)}</strong>
            </>
          )}
        </p>
      ) : null}
      <div>
        <SubmitButton size="sm">Save family discussion</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function EnquiryFollowUpForm({ enquiryId, today, assignees, assignedToId }: { enquiryId: string; today: string; assignees: SelectOption[]; assignedToId: string | null }) {
  return (
    <ActionForm action={addEnquiryFollowUpAction} className="gap-4" resetOnSuccess>
      <input type="hidden" name="enquiryId" value={enquiryId} />
      <TextareaField name="note" label="What happened" rows={2} required placeholder="Called the parent; they will visit on Saturday." />
      <FieldRow>
        <TextField name="nextFollowUpOn" label="Next follow-up" type="date" min={today} />
        <TextField name="nextAction" label="Next action" placeholder="e.g. Visit with documents" />
      </FieldRow>
      {assignees.length ? <SelectField name="assignedToId" label="Assigned to" options={assignees} placeholder="Keep as is" defaultValue={assignedToId ?? ""} /> : null}
      <div>
        <SubmitButton size="sm">Save follow-up</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function EnquiryStatusForm({ enquiryId, status }: { enquiryId: string; status: string }) {
  const [next, setNext] = useState(status === "CLOSED" ? "FOLLOW_UP" : "CONTACTED");
  return (
    <ActionForm action={setEnquiryStatusAction} className="gap-3">
      <input type="hidden" name="enquiryId" value={enquiryId} />
      <SelectField
        name="status"
        label={status === "CLOSED" ? "Reopen as" : "Mark as"}
        value={next}
        onChange={(event) => setNext(event.target.value)}
        options={[
          { value: "NEW", label: "New" },
          { value: "CONTACTED", label: "Contacted" },
          { value: "FOLLOW_UP", label: "Follow up" },
          ...(status === "CLOSED" ? [] : [{ value: "CLOSED", label: "Closed (not proceeding)" }]),
        ]}
      />
      {next === "CLOSED" ? <TextField name="reason" label="Why is it closed?" required placeholder="e.g. Family chose another school" /> : null}
      <div>
        <SubmitButton size="sm" variant="outline">
          Update status
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export type ConcessionRow = {
  childId: string;
  name: string;
  className: string;
  agreedDiscountMinor: number;
  charges: Array<{ id: string; head: string; amountMinor: number; hasConcession: boolean }>;
  suggestedChargeId: string | null;
};

/**
 * "Apply discussed discount to actual fee records?" Each ticked child gets a
 * concession on one of their own fees. Nothing happens until the office ticks
 * the confirmation and presses Confirm.
 */
export function ApplyConcessionsForm({ enquiryId, rows }: { enquiryId: string; rows: ConcessionRow[] }) {
  return (
    <ActionForm action={applyConcessionsAction} className="gap-5">
      <input type="hidden" name="enquiryId" value={enquiryId} />
      {rows.map((row, index) => (
        <div key={row.childId} className="flex flex-col gap-3 rounded-2xl border p-4">
          <input type="hidden" name={`apply.${index}.childId`} value={row.childId} />
          <CheckboxField name={`apply.${index}.include`} label={`${row.name} · ${row.className} — agreed discount ${rupees(row.agreedDiscountMinor)}`} defaultChecked />
          <FieldRow>
            <SelectField
              name={`apply.${index}.chargeId`}
              label="Put the concession on"
              defaultValue={row.suggestedChargeId ?? ""}
              options={row.charges.map((charge) => ({ value: charge.id, label: `${charge.head} — ${rupees(charge.amountMinor)}${charge.hasConcession ? " (replaces its concession)" : ""}` }))}
              required
            />
            <TextField name={`apply.${index}.amount`} label="Discount (₹)" inputMode="decimal" defaultValue={String(row.agreedDiscountMinor / 100)} required />
          </FieldRow>
        </div>
      ))}
      <CheckboxField name="confirm" label="I confirm: create these concessions on the children's actual fee records." hint="The fees keep their original amounts; each concession records the reason and that you approved it." />
      <div className="flex flex-wrap gap-3">
        <SubmitButton pendingLabel="Applying…">Confirm</SubmitButton>
      </div>
    </ActionForm>
  );
}
