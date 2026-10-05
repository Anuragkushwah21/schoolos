"use client";

import { useState } from "react";

import { ActionForm } from "@/components/forms/action-form";
import {
  FieldRow,
  type SelectOption,
  SelectField,
  SubmitButton,
  TextField,
  TextareaField,
} from "@/components/forms/fields";
import { type SectionSeats, StreamSeatPicker } from "@/features/school/stream-seat-picker";

import { acceptApplicationAction, setApplicationStatusAction } from "./actions";

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

export function AcceptApplicationForm({
  applicationId,
  sections,
  defaultSectionId,
  seats = {},
  requestedStreamId,
}: {
  applicationId: string;
  sections: SelectOption[];
  defaultSectionId?: string;
  /** Each section's stream shares and free seats. */
  seats?: Record<string, SectionSeats>;
  /** The stream the family applied for, preselected where offered. */
  requestedStreamId?: string | null;
}) {
  const [sectionId, setSectionId] = useState(defaultSectionId ?? "");
  return (
    <ActionForm action={acceptApplicationAction} className="gap-4">
      <input type="hidden" name="applicationId" value={applicationId} />
      <SelectField
        name="sectionId"
        label="Place in section"
        options={sections}
        value={sectionId}
        onChange={(event) => setSectionId(event.target.value)}
        placeholder="Select…"
        required
      />
      <StreamSeatPicker key={sectionId} seats={seats[sectionId]} defaultValue={requestedStreamId} />
      <FieldRow>
        <TextField name="rollNumber" label="Roll number" />
        <TextField name="admissionNumber" label="Admission number" hint="Blank to number automatically." />
      </FieldRow>
      <TextareaField name="reviewNotes" label="Notes" rows={2} />
      <div>
        <SubmitButton pendingLabel="Admitting…">Accept and admit</SubmitButton>
      </div>
    </ActionForm>
  );
}
