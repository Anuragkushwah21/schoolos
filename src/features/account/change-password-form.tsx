"use client";

import { ActionForm } from "@/components/forms/action-form";
import { SubmitButton, TextField } from "@/components/forms/fields";

import { changePasswordAction } from "./actions";

export function ChangePasswordForm() {
  return (
    <ActionForm action={changePasswordAction} resetOnSuccess className="max-w-sm">
      <TextField
        name="currentPassword"
        label="Current password"
        type="password"
        autoComplete="current-password"
        required
      />
      <TextField
        name="newPassword"
        label="New password"
        type="password"
        autoComplete="new-password"
        hint="At least 10 characters, with a letter and a number."
        required
      />
      <TextField
        name="confirmPassword"
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        required
      />
      <div>
        <SubmitButton pendingLabel="Changing…">Change password</SubmitButton>
      </div>
    </ActionForm>
  );
}
