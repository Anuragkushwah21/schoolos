"use client";

import { ActionForm } from "@/components/forms/action-form";
import { addDays, today, toDateInput } from "@/lib/dates";
import { FieldRow, SelectField, SubmitButton, TextField } from "@/components/forms/fields";

import { createApiTokenAction } from "./actions";

export function CreateTokenForm() {
  return (
    <ActionForm action={createApiTokenAction} resetOnSuccess>
      <FieldRow>
        <TextField name="name" label="What is it for?" placeholder="Attendance export script" required />
        <SelectField
          name="scope"
          label="Access"
          defaultValue="READ"
          options={[
            { value: "READ", label: "Read only" },
            { value: "FULL", label: "Read and write" },
          ]}
          hint="A read-only token is refused on every write."
          required
        />
      </FieldRow>
      <FieldRow>
        <TextField
          name="expiresAt"
          label="Expires"
          type="date"
          min={toDateInput(addDays(today(), 1))}
          hint="Leave blank for no expiry."
        />
        <div />
      </FieldRow>
      <div>
        <SubmitButton pendingLabel="Creating…">Create token</SubmitButton>
      </div>
    </ActionForm>
  );
}
