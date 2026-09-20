"use client";

import { ActionForm } from "@/components/forms/action-form";
import {
  CheckboxField,
  FieldRow,
  type SelectOption,
  SelectField,
  SubmitButton,
  TextField,
} from "@/components/forms/fields";

import {
  createAcademicSessionAction,
  createClassAction,
  createSectionAction,
  createStreamAction,
  createSubjectAction,
  updateSectionAction,
} from "./academics-actions";

export function AcademicSessionForm({ suggestion }: { suggestion: { name: string; startDate: string; endDate: string } }) {
  return (
    <ActionForm action={createAcademicSessionAction} resetOnSuccess>
      <FieldRow>
        <TextField name="name" label="Name" defaultValue={suggestion.name} required />
        <div />
      </FieldRow>
      <FieldRow>
        <TextField name="startDate" label="Starts" type="date" defaultValue={suggestion.startDate} required />
        <TextField name="endDate" label="Ends" type="date" defaultValue={suggestion.endDate} required />
      </FieldRow>
      <CheckboxField
        name="makeCurrent"
        label="Make this the current session"
        hint="New admissions, timetables and attendance use the current session."
      />
      <div>
        <SubmitButton>Create session</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function InlineCreateForm({
  kind,
}: {
  kind: "stream" | "subject" | "class";
}) {
  const action =
    kind === "stream" ? createStreamAction : kind === "subject" ? createSubjectAction : createClassAction;

  return (
    <ActionForm action={action} resetOnSuccess className="gap-3">
      <div className="flex flex-wrap items-start gap-3">
        <TextField
          name="name"
          label={kind === "stream" ? "New stream" : kind === "subject" ? "New subject" : "New class"}
          placeholder={kind === "stream" ? "Vocational" : kind === "subject" ? "Physics" : "Class 13"}
          className="min-w-40 flex-1"
          required
        />
        {kind === "subject" ? (
          <TextField name="code" label="Code" placeholder="PHY" className="w-28" required />
        ) : null}
        {kind === "class" ? (
          <TextField
            name="level"
            label="Order"
            inputMode="numeric"
            placeholder="13"
            className="w-24"
            hint="Nursery −3, LKG −2, UKG −1"
            required
          />
        ) : null}
      </div>
      <div>
        <SubmitButton variant="outline" size="sm">
          Add
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export function CreateSectionForm({
  academicSessionId,
  classes,
  streams,
  teachers,
  defaultClassId,
}: {
  academicSessionId: string;
  classes: SelectOption[];
  streams: SelectOption[];
  teachers: SelectOption[];
  defaultClassId?: string;
}) {
  return (
    <ActionForm action={createSectionAction} resetOnSuccess>
      <input type="hidden" name="academicSessionId" value={academicSessionId} />
      <FieldRow>
        <SelectField name="classId" label="Class" options={classes} defaultValue={defaultClassId} required />
        <TextField name="name" label="Section" placeholder="A" required />
      </FieldRow>
      <FieldRow>
        <SelectField name="streamId" label="Stream" options={streams} placeholder="None" />
        <TextField name="capacity" label="Capacity" inputMode="numeric" placeholder="40" />
      </FieldRow>
      <SelectField name="classTeacherId" label="Class teacher" options={teachers} placeholder="Not assigned" />
      <div>
        <SubmitButton>Create section</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function EditSectionForm({
  section,
  streams,
  teachers,
}: {
  section: { id: string; name: string; streamId: string | null; capacity: number | null; classTeacherId: string | null };
  streams: SelectOption[];
  teachers: SelectOption[];
}) {
  return (
    <ActionForm action={updateSectionAction}>
      <input type="hidden" name="sectionId" value={section.id} />
      <FieldRow>
        <TextField name="name" label="Section" defaultValue={section.name} required />
        <TextField name="capacity" label="Capacity" inputMode="numeric" defaultValue={section.capacity ?? ""} />
      </FieldRow>
      <FieldRow>
        <SelectField name="streamId" label="Stream" options={streams} placeholder="None" defaultValue={section.streamId ?? ""} />
        <SelectField
          name="classTeacherId"
          label="Class teacher"
          options={teachers}
          placeholder="Not assigned"
          defaultValue={section.classTeacherId ?? ""}
          hint="The class teacher can mark this section's attendance."
        />
      </FieldRow>
      <div>
        <SubmitButton>Save section</SubmitButton>
      </div>
    </ActionForm>
  );
}
