"use client";

import { useState } from "react";

import { ActionForm, useFormContext } from "@/components/forms/action-form";
import { FieldRow, SelectField, SubmitButton, TextareaField, TextField } from "@/components/forms/fields";
import { FieldError } from "@/components/shared/field-error";

import { cancelMeetingAction, saveMeetingAction } from "./meeting-actions";

type Option = { value: string; label: string };

const GROUPS = [
  { value: "PARENTS", label: "Parents" },
  { value: "STUDENTS", label: "Students" },
  { value: "TEACHERS", label: "Teachers" },
  { value: "NON_TEACHING_STAFF", label: "Non-teaching staff" },
] as const;

function CheckboxGroup({ name, label, options, checked = [], hint }: { name: string; label: string; options: Option[]; checked?: string[]; hint?: string }) {
  const { fieldErrors } = useFormContext();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">{label}</legend>
      {options.length ? (
        <div className="grid max-h-64 gap-x-4 gap-y-1.5 overflow-y-auto rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-3">
          {options.map((option) => (
            <label key={option.value} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name={name} value={option.value} defaultChecked={checked.includes(option.value)} className="accent-primary size-4" />
              {option.label}
            </label>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground rounded-lg border p-3 text-sm">None available.</p>
      )}
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
      <FieldError id={`${name}-error`} messages={fieldErrors?.[name]} />
    </fieldset>
  );
}

/** Errors for a field drawn by hand here, read from the enclosing form. */
function FormFieldError({ name }: { name: string }) {
  const { fieldErrors } = useFormContext();
  return <FieldError id={`${name}-error`} messages={fieldErrors?.[name]} />;
}

export type MeetingFormDefaults = {
  id: string;
  type: string;
  title: string;
  description: string;
  date: string;
  startMinute: string;
  endMinute: string;
  location: string;
  meetingLink: string;
  audiences: string[];
  scope: string;
  sectionIds: string[];
  teacherIds: string[];
  staffIds: string[];
  admissionNumbers: string;
};

/**
 * Schedule or edit a meeting. Nobody books a slot: the office sets the time and
 * picks who is invited — groups, then optionally only some sections or people.
 * The date picker starts today; the server refuses a start time already past.
 */
export function MeetingForm({
  meeting,
  prefill,
  today,
  sections,
  teachers,
  staff,
}: {
  meeting?: MeetingFormDefaults;
  /** Starting values for a new meeting (e.g. an extra class for a support record). */
  prefill?: Partial<MeetingFormDefaults> & { supportId?: string };
  today: string;
  sections: Option[];
  teachers: Option[];
  staff: Option[];
}) {
  // Editing shows the meeting as saved; a new one may start from a prefill.
  const d: Partial<MeetingFormDefaults> | undefined = meeting ?? prefill;
  const initial = d?.audiences?.includes("ALL") ? GROUPS.map((group) => group.value) : (d?.audiences ?? ["PARENTS"]);
  const [groups, setGroups] = useState<string[]>(initial);
  const [scope, setScope] = useState(d?.scope ?? "SCHOOL");
  const toggle = (value: string, on: boolean) => setGroups((current) => (on ? [...new Set([...current, value])] : current.filter((item) => item !== value)));
  const all = GROUPS.every((group) => groups.includes(group.value));

  return (
    <ActionForm action={saveMeetingAction} className="max-w-4xl">
      {meeting ? <input type="hidden" name="meetingId" value={meeting.id} /> : null}
      {!meeting && prefill?.supportId ? <input type="hidden" name="supportId" value={prefill.supportId} /> : null}
      <FieldRow>
        <TextField name="title" label="Title" placeholder="Class 10-A parent meeting" defaultValue={d?.title} required />
        <SelectField
          name="type"
          label="Kind"
          defaultValue={d?.type ?? "GENERAL"}
          options={[
            { value: "PTM", label: "Parent-teacher meeting" },
            { value: "GENERAL", label: "Other meeting" },
          ]}
          required
        />
      </FieldRow>
      <TextareaField name="description" label="Message" rows={4} defaultValue={d?.description} hint="What the meeting is about and anything people should bring." />
      <FieldRow className="sm:grid-cols-3">
        <TextField name="date" label="Date" type="date" min={today} defaultValue={d?.date} required />
        <TextField name="startMinute" label="Starts" type="time" defaultValue={d?.startMinute ?? "10:00"} required />
        <TextField name="endMinute" label="Ends" type="time" defaultValue={d?.endMinute} hint="Optional. Without it, the meeting runs to the end of the day." />
      </FieldRow>
      <FieldRow>
        <TextField name="location" label="Location" placeholder="School auditorium" defaultValue={d?.location} />
        <TextField name="meetingLink" label="Online meeting link" type="url" placeholder="https://" defaultValue={d?.meetingLink} />
      </FieldRow>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">
          Who is invited<span className="text-destructive">*</span>
        </legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2 rounded-lg border p-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={all}
              onChange={(event) => setGroups(event.target.checked ? GROUPS.map((group) => group.value) : [])}
              className="accent-primary size-4"
            />
            Everyone
          </label>
          {GROUPS.map((group) => (
            <label key={group.value} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="audiences"
                value={group.value}
                checked={groups.includes(group.value)}
                onChange={(event) => toggle(group.value, event.target.checked)}
                className="accent-primary size-4"
              />
              {group.label}
            </label>
          ))}
        </div>
        <FormFieldError name="audiences" />
      </fieldset>

      <SelectField
        name="scope"
        label="Reach"
        value={scope}
        onChange={(event) => setScope(event.target.value)}
        options={[
          { value: "SCHOOL", label: "Whole school — everyone in the groups above" },
          { value: "SECTIONS", label: "Chosen classes — their students, parents and teachers" },
          { value: "PEOPLE", label: "Selected people only" },
        ]}
        hint="Combined with the groups: Parents + one section reaches only that section's parents."
        required
      />

      {scope === "SECTIONS" ? (
        <CheckboxGroup
          name="sectionIds"
          label="Sections"
          options={sections}
          checked={d?.sectionIds}
          hint="Teachers means the class teacher and subject teachers of these sections."
        />
      ) : null}

      {scope === "PEOPLE" ? (
        <>
          {groups.includes("TEACHERS") ? <CheckboxGroup name="teacherIds" label="Teachers" options={teachers} checked={d?.teacherIds} /> : null}
          {groups.includes("NON_TEACHING_STAFF") ? (
            <CheckboxGroup
              name="staffIds"
              label="Non-teaching staff"
              options={staff}
              checked={d?.staffIds}
              hint="Only staff with a login are listed. Give a staff member a login from their page under Staff."
            />
          ) : null}
          {groups.includes("STUDENTS") || groups.includes("PARENTS") ? (
            <TextareaField
              name="studentAdmissionNumbers"
              label="Students (admission numbers)"
              rows={3}
              defaultValue={d?.admissionNumbers}
              hint="Separate with commas or new lines. With Parents ticked, their guardians are invited; with Students, the students themselves."
            />
          ) : null}
          {groups.length === 0 ? <p className="text-muted-foreground text-sm">Tick a group above to choose people from it.</p> : null}
        </>
      ) : null}

      <div>
        <SubmitButton pendingLabel={meeting ? "Saving changes…" : "Creating meeting…"}>{meeting ? "Save changes" : "Create meeting"}</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function CancelMeetingForm({ meetingId }: { meetingId: string }) {
  return (
    <ActionForm action={cancelMeetingAction} className="gap-3">
      <input type="hidden" name="meetingId" value={meetingId} />
      <TextField name="reason" label="Reason (shown to invitees)" placeholder="Postponed due to weather" />
      <div>
        <SubmitButton variant="destructive" pendingLabel="Cancelling…">
          Cancel meeting
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
