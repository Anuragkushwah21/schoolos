"use client";

import { ActionForm } from "@/components/forms/action-form";
import { FieldRow, PhoneField, SubmitButton, TextField } from "@/components/forms/fields";

import { createPrincipalAction } from "./actions";

export function PrincipalForm() {
  return (
    <ActionForm action={createPrincipalAction} className="gap-3" resetOnSuccess>
      <FieldRow>
        <TextField name="firstName" label="First name" required />
        <TextField name="lastName" label="Last name" required />
      </FieldRow>
      <FieldRow>
        <TextField name="email" label="Email (their sign-in)" type="email" required />
        <PhoneField name="phone" label="Mobile" />
      </FieldRow>
      <div>
        <SubmitButton pendingLabel="Creating…">Create Principal login</SubmitButton>
      </div>
    </ActionForm>
  );
}
