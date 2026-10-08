"use client";

import { ClockIcon } from "lucide-react";

import { ActionForm } from "@/components/forms/action-form";
import { CheckboxField, FieldRow, PhoneField, SelectField, SubmitButton, TextField, TextareaField } from "@/components/forms/fields";

import { recordVisitorEntryAction, updateVisitorAction } from "./actions";

export function VisitorEntryForm() {
  return (
    <ActionForm action={recordVisitorEntryAction} className="gap-3" resetOnSuccess>
      <FieldRow>
        <TextField name="name" label="Visitor name" required />
        <PhoneField name="phone" label="Mobile" required />
      </FieldRow>
      <FieldRow>
        <TextField name="purpose" label="Purpose" placeholder="Fee enquiry, delivery, meeting…" required />
        <TextField name="personToMeet" label="Person to meet" placeholder="Name or office" required />
      </FieldRow>
      <FieldRow>
        <TextField name="vehicleNo" label="Vehicle number" placeholder="If any" />
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Date &amp; time</span>
          <p className="bg-muted text-muted-foreground flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm">
            <ClockIcon className="size-4 shrink-0" aria-hidden />
            Today, now — filled in automatically
          </p>
        </div>
      </FieldRow>
      <TextareaField name="notes" label="Notes" rows={2} />
      <CheckboxField name="denied" label="Turned away at the gate" hint="Recorded, but not let in." />
      <div>
        <SubmitButton pendingLabel="Saving…">Log visitor</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function VisitorEditForm({
  visitor,
}: {
  visitor: { id: string; name: string; phone: string; purpose: string; personToMeet: string; vehicleNo: string | null; notes: string | null; status: string };
}) {
  return (
    <ActionForm action={updateVisitorAction} className="gap-3">
      <input type="hidden" name="visitorId" value={visitor.id} />
      <FieldRow>
        <TextField name="name" label="Visitor name" defaultValue={visitor.name} required />
        <PhoneField name="phone" label="Mobile" defaultValue={visitor.phone} required />
      </FieldRow>
      <FieldRow>
        <TextField name="purpose" label="Purpose" defaultValue={visitor.purpose} required />
        <TextField name="personToMeet" label="Person to meet" defaultValue={visitor.personToMeet} required />
      </FieldRow>
      <FieldRow>
        <TextField name="vehicleNo" label="Vehicle number" defaultValue={visitor.vehicleNo ?? ""} />
        <SelectField
          name="status"
          label="Status"
          defaultValue={visitor.status}
          options={[
            { value: "INSIDE", label: "Inside" },
            { value: "LEFT", label: "Left" },
            { value: "DENIED", label: "Turned away" },
          ]}
        />
      </FieldRow>
      <p className="text-muted-foreground text-xs">The entry and exit times stay as recorded at the gate. Setting “Left” marks them out now.</p>
      <TextareaField name="notes" label="Notes" rows={2} defaultValue={visitor.notes ?? ""} />
      <div>
        <SubmitButton variant="outline">Save correction</SubmitButton>
      </div>
    </ActionForm>
  );
}
