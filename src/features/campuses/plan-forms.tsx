"use client";

import { ActionForm } from "@/components/forms/action-form";
import { SubmitButton, TextareaField, TextField } from "@/components/forms/fields";

import { approvePlanChangeAction, rejectPlanChangeAction, requestPlanChangeAction } from "./plan-actions";

/** "Request this plan" on a plan card. */
export function RequestPlanForm({ planId, planName }: { planId: string; planName: string }) {
  return (
    <ActionForm action={requestPlanChangeAction} className="gap-2">
      <input type="hidden" name="planId" value={planId} />
      <TextField name="note" label="Note for SchoolOS (optional)" placeholder="e.g. opening a second campus in April" />
      <div>
        <SubmitButton size="sm" pendingLabel="Sending…">{`Request ${planName}`}</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** Super Admin: approve (the plan changes now) or reject with a reason. */
export function PlanDecisionForms({ requestId }: { requestId: string }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <ActionForm action={approvePlanChangeAction} className="gap-2">
        <input type="hidden" name="requestId" value={requestId} />
        <TextField name="reviewNote" label="Note (optional)" />
        <div>
          <SubmitButton size="sm" pendingLabel="Approving…">Approve & change plan</SubmitButton>
        </div>
      </ActionForm>
      <ActionForm action={rejectPlanChangeAction} className="gap-2">
        <input type="hidden" name="requestId" value={requestId} />
        <TextareaField name="reason" label="Reason for rejecting" rows={1} required />
        <div>
          <SubmitButton size="sm" variant="outline" pendingLabel="Rejecting…">
            Reject
          </SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}
