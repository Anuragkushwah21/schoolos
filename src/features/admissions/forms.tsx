"use client";

import { ActionForm } from "@/components/forms/action-form";
import { SelectField, SubmitButton, TextareaField } from "@/components/forms/fields";

import { setApplicationStatusAction } from "./actions";

const NEXT_STEPS = [
  { value: "UNDER_REVIEW", label: "Under review" },
  { value: "SHORTLISTED", label: "Shortlist" },
  { value: "APPROVED", label: "Approve" },
  { value: "REJECTED", label: "Reject" },
];

export function ApplicationStatusForm({ applicationId, status }: { applicationId: string; status: string }) {
  const options = NEXT_STEPS.filter((option) => option.value !== status);
  // Suggest the next step along: submitted → under review → shortlisted → approved.
  // An approved one has no "next" here (converting is the next step), so nothing is preselected.
  const suggested = status === "SUBMITTED" ? "UNDER_REVIEW" : status === "UNDER_REVIEW" ? "SHORTLISTED" : status === "SHORTLISTED" ? "APPROVED" : "";
  return (
    <ActionForm action={setApplicationStatusAction} className="gap-3" resetOnSuccess>
      <input type="hidden" name="applicationId" value={applicationId} />
      <SelectField name="status" label="Move to" options={options} defaultValue={suggested} placeholder={suggested ? undefined : "Choose…"} required />
      <TextareaField name="reviewNotes" label="Notes" rows={2} hint="Internal — not shown to the family." />
      <div>
        <SubmitButton variant="outline">Update</SubmitButton>
      </div>
    </ActionForm>
  );
}
