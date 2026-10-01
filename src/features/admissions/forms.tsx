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
import { today, toDateInput } from "@/lib/dates";
import { type SectionSeats, StreamSeatPicker } from "@/features/school/stream-seat-picker";

import { acceptApplicationAction, setApplicationStatusAction, submitApplicationAction } from "./actions";

export function ApplicationForm({
  slug,
  classes,
  streams,
}: {
  slug: string;
  classes: SelectOption[];
  streams: SelectOption[];
}) {
  return (
    <ActionForm action={submitApplicationAction}>
      <input type="hidden" name="slug" value={slug} />

      <fieldset className="flex flex-col gap-5">
        <legend className="mb-4 text-sm font-semibold">About the child</legend>
        <FieldRow>
          <TextField name="studentFirstName" label="First name" required />
          <TextField name="studentLastName" label="Last name" required />
        </FieldRow>
        <FieldRow>
          <TextField name="dateOfBirth" label="Date of birth" type="date" max={toDateInput(today())} />
          <SelectField
            name="gender"
            label="Gender"
            placeholder="Prefer not to say"
            options={[
              { value: "MALE", label: "Male" },
              { value: "FEMALE", label: "Female" },
              { value: "OTHER", label: "Other" },
            ]}
          />
        </FieldRow>
        <FieldRow>
          <SelectField name="requestedClassId" label="Applying for class" options={classes} placeholder="Select…" required />
          {streams.length ? (
            <SelectField name="requestedStreamId" label="Stream (Class 11–12)" options={streams} placeholder="Not applicable" />
          ) : (
            <div />
          )}
        </FieldRow>
        <TextField name="previousSchool" label="Previous school" />
      </fieldset>

      <fieldset className="flex flex-col gap-5">
        <legend className="mb-4 text-sm font-semibold">Parent or guardian</legend>
        <FieldRow>
          <TextField name="parentName" label="Your full name" required autoComplete="name" />
          <SelectField
            name="parentRelationship"
            label="Relationship"
            defaultValue="FATHER"
            options={[
              { value: "FATHER", label: "Father" },
              { value: "MOTHER", label: "Mother" },
              { value: "GUARDIAN", label: "Guardian" },
            ]}
            required
          />
        </FieldRow>
        <FieldRow>
          <TextField name="parentPhone" label="Phone" type="tel" required autoComplete="tel" />
          <TextField name="parentEmail" label="Email" type="email" autoComplete="email" />
        </FieldRow>
        <TextField name="addressLine" label="Address" autoComplete="street-address" />
        <FieldRow>
          <TextField name="city" label="City" autoComplete="address-level2" />
          <TextField name="state" label="State" autoComplete="address-level1" />
        </FieldRow>
        <TextareaField name="notes" label="Anything the school should know" rows={3} />
      </fieldset>

      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <div>
        <SubmitButton pendingLabel="Submitting…" className="h-10 px-6">
          Submit application
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export function ApplicationStatusForm({ applicationId }: { applicationId: string }) {
  return (
    <ActionForm action={setApplicationStatusAction} className="gap-3" resetOnSuccess>
      <input type="hidden" name="applicationId" value={applicationId} />
      <SelectField
        name="status"
        label="Decision"
        options={[
          { value: "UNDER_REVIEW", label: "Under review" },
          { value: "WAITLISTED", label: "Waitlist" },
          { value: "REJECTED", label: "Reject" },
        ]}
        required
      />
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
