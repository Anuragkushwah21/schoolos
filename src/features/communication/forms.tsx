"use client";

import { useState } from "react";

import { ActionForm } from "@/components/forms/action-form";
import {
  CheckboxField,
  FieldRow,
  SelectField,
  SubmitButton,
  TextField,
  TextareaField,
} from "@/components/forms/fields";

import { saveEventAction, saveNoticeAction } from "./actions";

const FORMAT_HINT = "Blank line for a new paragraph. Start lines with - for a list, **bold**, [link](https://…).";

type Option = { value: string; label: string };

/** Who the notice is for, within the audience above it. */
function TargetFields({
  defaults,
  classes,
  sections,
}: {
  defaults?: { scope: string; classId: string | null; sectionId: string | null; admissionNumbers: string };
  classes: Option[];
  sections: Option[];
}) {
  const [scope, setScope] = useState(defaults?.scope ?? "SCHOOL");
  return (
    <>
      <SelectField
        name="scope"
        label="Send to"
        value={scope}
        onChange={(event) => setScope(event.target.value)}
        options={[
          { value: "SCHOOL", label: "The whole school" },
          { value: "CLASS", label: "One class" },
          { value: "SECTION", label: "One section" },
          { value: "STUDENTS", label: "Particular students (and their parents)" },
        ]}
        hint="Combined with the audience: e.g. Parents + One section reaches that section's parents only."
        required
      />
      {scope === "CLASS" ? (
        <SelectField name="classId" label="Class" options={classes} defaultValue={defaults?.classId ?? undefined} placeholder="Choose a class" required />
      ) : null}
      {scope === "SECTION" ? (
        <SelectField name="sectionId" label="Section" options={sections} defaultValue={defaults?.sectionId ?? undefined} placeholder="Choose a section" required />
      ) : null}
      {scope === "STUDENTS" ? (
        <TextareaField
          name="studentAdmissionNumbers"
          label="Admission numbers"
          rows={3}
          defaultValue={defaults?.admissionNumbers}
          hint="Separate with commas or new lines. Every number must belong to a student of your school."
          required
        />
      ) : null}
    </>
  );
}

export function NoticeForm({
  notice,
  minExpiry,
  classes = [],
  sections = [],
}: {
  notice?: {
    id: string;
    title: string;
    body: string;
    audience: string;
    status: string;
    isPublic: boolean;
    publishAt: string;
    expiresAt: string;
    scope: string;
    classId: string | null;
    sectionId: string | null;
    admissionNumbers: string;
  };
  classes?: Option[];
  sections?: Option[];
  /** Earliest "Hide after" the picker offers: today, or an existing earlier expiry. */
  minExpiry?: string;
}) {
  return (
    <ActionForm action={saveNoticeAction} className="max-w-3xl">
      {notice ? <input type="hidden" name="noticeId" value={notice.id} /> : null}
      <TextField name="title" label="Title" defaultValue={notice?.title} required />
      <TextareaField name="body" label="Notice" defaultValue={notice?.body} rows={8} hint={FORMAT_HINT} required />
      <FieldRow>
        <SelectField
          name="audience"
          label="Who sees it after signing in"
          defaultValue={notice?.audience ?? "ALL"}
          options={[
            { value: "ALL", label: "Everyone" },
            { value: "TEACHERS", label: "Teachers" },
            { value: "STUDENTS", label: "Students" },
            { value: "PARENTS", label: "Parents" },
            { value: "NON_TEACHING_STAFF", label: "Non-teaching staff" },
          ]}
          required
        />
        <SelectField
          name="status"
          label="Status"
          defaultValue={notice?.status ?? "PUBLISHED"}
          options={[
            { value: "DRAFT", label: "Draft — not visible" },
            { value: "PUBLISHED", label: "Published" },
            { value: "ARCHIVED", label: "Archived — hidden" },
          ]}
          required
        />
      </FieldRow>
      <TargetFields defaults={notice} classes={classes} sections={sections} />
      <FieldRow>
        <TextField name="publishAt" label="Publish on" type="date" defaultValue={notice?.publishAt} hint="Leave blank to publish immediately." />
        <TextField
          name="expiresAt"
          label="Hide after"
          type="date"
          defaultValue={notice?.expiresAt}
          min={minExpiry}
          hint="Leave blank to keep it up."
        />
      </FieldRow>
      <CheckboxField
        name="isPublic"
        label="Also show on the school website"
        hint="Whole-school notices only. Anyone on the internet can read public notices — never include personal details."
        defaultChecked={notice?.isPublic}
      />
      <div>
        <SubmitButton pendingLabel="Saving notice…">Save notice</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function EventForm({
  event,
  minDate,
}: {
  event?: {
    id: string;
    title: string;
    description: string | null;
    date: string;
    startMinute: string;
    endMinute: string;
    location: string | null;
    imageUrl: string | null;
    isPublished: boolean;
  };
  /** Earliest date the picker offers: today, or the event's own date if it has passed. */
  minDate?: string;
}) {
  return (
    <ActionForm action={saveEventAction} className="max-w-3xl">
      {event ? <input type="hidden" name="eventId" value={event.id} /> : null}
      <TextField name="title" label="Title" defaultValue={event?.title} required />
      <TextareaField name="description" label="Description" defaultValue={event?.description ?? ""} rows={4} hint={FORMAT_HINT} />
      <FieldRow>
        <TextField name="date" label="Date" type="date" defaultValue={event?.date} min={minDate} required />
        <TextField name="location" label="Location" defaultValue={event?.location ?? ""} />
      </FieldRow>
      <FieldRow>
        <TextField name="startMinute" label="Starts" type="time" defaultValue={event?.startMinute} />
        <TextField name="endMinute" label="Ends" type="time" defaultValue={event?.endMinute} />
      </FieldRow>
      <TextField name="imageUrl" label="Image link" placeholder="https://…" defaultValue={event?.imageUrl ?? ""} />
      <CheckboxField
        name="isPublished"
        label="Published"
        hint="Published events appear on dashboards and the school website."
        defaultChecked={event?.isPublished ?? true}
      />
      <div>
        <SubmitButton>Save event</SubmitButton>
      </div>
    </ActionForm>
  );
}
