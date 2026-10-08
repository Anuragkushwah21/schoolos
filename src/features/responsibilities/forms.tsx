"use client";

import { ActionForm } from "@/components/forms/action-form";
import { FieldRow, SelectField, SubmitButton, TextField, TextareaField } from "@/components/forms/fields";
import { RESPONSIBILITY_PRIORITIES, RESPONSIBILITY_TYPES } from "@/lib/responsibilities";

import { createResponsibilityAction, responsibilityProgressAction, updateResponsibilityAction } from "./actions";

type Person = { id: string; label: string };
type Existing = {
  id: string;
  title: string;
  description: string | null;
  type: string;
  assignedToId: string;
  startDate: string;
  endDate: string;
  priority: string;
  notes: string | null;
};

const TYPE_OPTIONS = RESPONSIBILITY_TYPES.map((type) => ({ value: type.key, label: type.label }));
const PRIORITY_OPTIONS = RESPONSIBILITY_PRIORITIES.map((priority) => ({ value: priority.value, label: priority.label }));

function Fields({ people, existing, today }: { people: Person[]; existing?: Existing; today: string }) {
  return (
    <>
      <FieldRow>
        <SelectField name="type" label="Type" options={TYPE_OPTIONS} defaultValue={existing?.type ?? ""} placeholder="Choose…" required />
        <SelectField
          name="assignedToId"
          label={existing ? "Given to (change to reassign)" : "Give to"}
          options={people.map((person) => ({ value: person.id, label: person.label }))}
          defaultValue={existing?.assignedToId ?? ""}
          placeholder="Choose a teacher or staff member…"
          required
        />
      </FieldRow>
      <TextField name="title" label="Title" placeholder="Annual Sports Day 2026" defaultValue={existing?.title} required />
      <TextareaField name="description" label="What needs to be done" rows={3} defaultValue={existing?.description ?? ""} />
      <FieldRow>
        <TextField name="startDate" label="Start date" type="date" defaultValue={existing?.startDate ?? today} required />
        <TextField name="endDate" label="Due by" type="date" defaultValue={existing?.endDate ?? ""} hint="Optional" />
      </FieldRow>
      <FieldRow>
        <SelectField name="priority" label="Priority" options={PRIORITY_OPTIONS} defaultValue={existing?.priority ?? "NORMAL"} />
        <TextField name="notes" label="Notes" defaultValue={existing?.notes ?? ""} />
      </FieldRow>
    </>
  );
}

/** Give a responsibility to a teacher or staff member. */
export function ResponsibilityForm({ people, today }: { people: Person[]; today: string }) {
  return (
    <ActionForm action={createResponsibilityAction} className="gap-3" resetOnSuccess>
      <Fields people={people} today={today} />
      <p className="text-muted-foreground text-xs">A responsibility is a task to track. It does not give the person any new access.</p>
      <div>
        <SubmitButton pendingLabel="Assigning…">Assign responsibility</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function ResponsibilityEditForm({ people, existing, today }: { people: Person[]; existing: Existing; today: string }) {
  return (
    <ActionForm action={updateResponsibilityAction} className="gap-3">
      <input type="hidden" name="responsibilityId" value={existing.id} />
      <Fields people={people} existing={existing} today={today} />
      <div>
        <SubmitButton variant="outline">Save changes</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** The assignee's progress note. */
export function ProgressForm({ id, note }: { id: string; note: string | null }) {
  return (
    <ActionForm action={responsibilityProgressAction} className="gap-2">
      <input type="hidden" name="responsibilityId" value={id} />
      <TextareaField name="progressNote" label="Progress update" rows={2} defaultValue={note ?? ""} placeholder="What is done so far" required />
      <div>
        <SubmitButton variant="outline" size="sm">
          Save progress
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
