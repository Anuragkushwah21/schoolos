"use client";

import { ActionForm } from "@/components/forms/action-form";
import { FieldRow, SelectField, SubmitButton, TextareaField, TextField } from "@/components/forms/fields";
import { humanize } from "@/lib/format";
import { COMPLAINT_CATEGORIES, COMPLAINT_PRIORITIES, COMPLAINT_STATUSES } from "@/lib/validation/complaints";

import { handleComplaintAction, raiseComplaintAction } from "./complaint-actions";

type Option = { value: string; label: string };
const options = (values: readonly string[]) => values.map((value) => ({ value, label: humanize(value) }));

export function RaiseComplaintForm({ childOptions }: { childOptions?: Option[] }) {
  return (
    <ActionForm action={raiseComplaintAction} resetOnSuccess className="max-w-2xl">
      {childOptions ? (
        <SelectField name="studentId" label="About" options={childOptions} placeholder="The school in general" />
      ) : null}
      <FieldRow>
        <SelectField name="category" label="Category" options={options(COMPLAINT_CATEGORIES)} placeholder="Choose" required />
        <SelectField name="priority" label="Priority" options={options(COMPLAINT_PRIORITIES)} defaultValue="MEDIUM" required />
      </FieldRow>
      <TextField name="subject" label="Subject" required />
      <TextareaField name="description" label="Details" rows={5} required />
      <div>
        <SubmitButton>Send</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** The office (with reassignment) or the assigned teacher (without). */
export function HandleComplaintForm({
  complaint,
  staff,
}: {
  complaint: { id: string; status: string; assignedToId: string | null; response: string | null };
  staff?: Option[];
}) {
  return (
    <ActionForm action={handleComplaintAction} className="max-w-2xl">
      <input type="hidden" name="complaintId" value={complaint.id} />
      {!staff && complaint.assignedToId ? <input type="hidden" name="assignedToId" value={complaint.assignedToId} /> : null}
      <FieldRow>
        <SelectField name="status" label="Status" options={options(COMPLAINT_STATUSES)} defaultValue={complaint.status} required />
        {staff ? (
          <SelectField name="assignedToId" label="Assigned to" options={staff} defaultValue={complaint.assignedToId ?? undefined} placeholder="Nobody yet" />
        ) : null}
      </FieldRow>
      <TextareaField name="response" label="Response to the family" rows={4} defaultValue={complaint.response ?? ""} />
      <div>
        <SubmitButton>Save</SubmitButton>
      </div>
    </ActionForm>
  );
}
