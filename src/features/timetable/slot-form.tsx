"use client";

import { ActionForm } from "@/components/forms/action-form";
import { FieldRow, type SelectOption, SelectField, SubmitButton, TextField } from "@/components/forms/fields";

import { createSlotAction } from "./actions";

const DAY_OPTIONS: SelectOption[] = [
  { value: "MONDAY", label: "Monday" },
  { value: "TUESDAY", label: "Tuesday" },
  { value: "WEDNESDAY", label: "Wednesday" },
  { value: "THURSDAY", label: "Thursday" },
  { value: "FRIDAY", label: "Friday" },
  { value: "SATURDAY", label: "Saturday" },
];

export function SlotForm({
  sectionId,
  subjects,
  teachers,
}: {
  sectionId: string;
  subjects: SelectOption[];
  teachers: SelectOption[];
}) {
  return (
    <ActionForm action={createSlotAction}>
      <input type="hidden" name="sectionId" value={sectionId} />
      <FieldRow>
        <SelectField name="dayOfWeek" label="Day" options={DAY_OPTIONS} required />
        <TextField name="room" label="Room" placeholder="R101" />
      </FieldRow>
      <FieldRow>
        <TextField name="startMinute" label="Starts" type="time" defaultValue="09:00" required />
        <TextField name="endMinute" label="Ends" type="time" defaultValue="09:45" required />
      </FieldRow>
      <FieldRow>
        <SelectField name="subjectId" label="Subject" options={subjects} placeholder="Select…" required />
        <SelectField name="teacherId" label="Teacher" options={teachers} placeholder="Select…" required />
      </FieldRow>
      <p className="text-muted-foreground text-xs">
        Clashes with this section&apos;s or the teacher&apos;s other periods are refused.
        The teacher is also assigned the subject for this section.
      </p>
      <div>
        <SubmitButton>Add period</SubmitButton>
      </div>
    </ActionForm>
  );
}
