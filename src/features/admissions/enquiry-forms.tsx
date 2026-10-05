"use client";

import { ActionForm } from "@/components/forms/action-form";
import { SubmitButton, TextareaField, TextField } from "@/components/forms/fields";

import { addFollowUpAction } from "./actions";

/** A call or note on a public application, with an optional next follow-up date. */
export function FollowUpForm({ applicationId, today }: { applicationId: string; today: string }) {
  return (
    <ActionForm action={addFollowUpAction} resetOnSuccess className="gap-3">
      <input type="hidden" name="applicationId" value={applicationId} />
      <TextareaField name="note" label="What happened?" rows={2} placeholder="Called the father; visiting on Saturday with documents." maxLength={1000} required />
      <TextField name="nextFollowUpOn" label="Next follow-up (optional)" type="date" min={today} />
      <div>
        <SubmitButton variant="outline">Save follow-up</SubmitButton>
      </div>
    </ActionForm>
  );
}
