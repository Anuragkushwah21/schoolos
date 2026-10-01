"use client";

import { PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { ActionButton } from "@/components/forms/action-button";
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
  updateClassAction,
  updateSectionAction,
  saveStreamAllocationsAction,
  setClassTeacherAction,
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

export function EditClassForm({ klass }: { klass: { id: string; name: string; level: number } }) {
  return (
    <ActionForm action={updateClassAction} className="gap-3">
      <input type="hidden" name="classId" value={klass.id} />
      <div className="flex flex-wrap items-start gap-3">
        <TextField name="name" label="Class name" defaultValue={klass.name} className="min-w-40 flex-1" required />
        <TextField
          name="level"
          label="Order"
          inputMode="numeric"
          defaultValue={klass.level}
          className="w-24"
          hint="Nursery −3, LKG −2, UKG −1"
          required
        />
      </div>
      <div>
        <SubmitButton variant="outline" size="sm">
          Save class
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

/**
 * Assign, change or remove one section's class teacher.
 *
 * The options are the school's active teachers; the server checks the teacher
 * and the section again, inside the admin's own school, whatever is posted.
 */
export function ClassTeacherControl({
  sectionId,
  sectionLabel,
  current,
  teachers,
}: {
  sectionId: string;
  sectionLabel: string;
  current: { id: string; name: string } | null;
  teachers: Array<{ value: string; label: string }>;
}) {
  const choices = teachers.filter((teacher) => teacher.value !== current?.id);

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <ActionForm action={setClassTeacherAction} className="flex-1 gap-2 sm:flex-row sm:items-end">
        <input type="hidden" name="sectionId" value={sectionId} />
        <SelectField
          name="teacherId"
          label={current ? "Change to" : "Teacher"}
          options={choices}
          placeholder={choices.length ? "Choose a teacher" : "No other active teacher"}
          disabled={!choices.length}
          className="min-w-0 flex-1"
          aria-label={`${current ? "Change" : "Assign"} class teacher for ${sectionLabel}`}
          required
        />
        <SubmitButton size="sm" variant={current ? "outline" : "default"} pendingLabel="Saving…">
          {current ? "Change Teacher" : "Assign Teacher"}
        </SubmitButton>
      </ActionForm>
      {current ? (
        <ActionButton
          action={setClassTeacherAction}
          fields={{ sectionId, teacherId: "" }}
          variant="ghost"
          pendingLabel="Removing…"
          confirm={{
            title: `Remove ${current.name} as class teacher of ${sectionLabel}?`,
            description:
              "They keep any subjects they teach this section. The change is kept in the section's class-teacher history.",
            confirmLabel: "Remove Assignment",
          }}
        >
          Remove Assignment
        </ActionButton>
      ) : null}
    </div>
  );
}

type AllocationRow = { streamId: string; capacity: string; occupied: number };

/**
 * Share one section's seats among streams / groups — "Science 15, Commerce
 * 10, Arts 10, Agriculture 5" — in whatever split the school wants. Shows
 * allocated and remaining seats as you type; the server checks the same
 * rules again. Lowering a share below the students already in it is
 * allowed, and flagged: nobody is moved.
 */
export function StreamAllocationForm({
  sectionId,
  capacity,
  streams,
  current,
  wholeStream,
}: {
  sectionId: string;
  capacity: number | null;
  streams: SelectOption[];
  current: Array<{ streamId: string; capacity: number; occupied: number }>;
  /** Set when the whole section is one stream; shares are then not possible. */
  wholeStream: string | null;
}) {
  const [rows, setRows] = useState<AllocationRow[]>(current.map((row) => ({ streamId: row.streamId, capacity: String(row.capacity), occupied: row.occupied })));
  const allocated = rows.reduce((sum, row) => sum + (Number.parseInt(row.capacity, 10) || 0), 0);
  const over = capacity !== null && allocated > capacity;
  const used = new Set(rows.map((row) => row.streamId));
  const available = streams.filter((stream) => !used.has(stream.value));
  const update = (index: number, patch: Partial<AllocationRow>) => setRows((all) => all.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  if (wholeStream) {
    return <p className="text-muted-foreground text-sm">This whole section is {wholeStream}. To share its seats among several streams, set its stream to None under Section details first.</p>;
  }
  if (capacity === null) {
    return <p className="text-muted-foreground text-sm">Set the section&apos;s total capacity under Section details first; then share it among streams here.</p>;
  }

  const payload = JSON.stringify(rows.filter((row) => row.streamId).map((row) => ({ streamId: row.streamId, capacity: Number.parseInt(row.capacity, 10) || 0 })));
  const percent = capacity ? Math.min(100, Math.round((allocated / capacity) * 100)) : 0;

  return (
    <ActionForm action={saveStreamAllocationsAction} className="gap-4">
      <input type="hidden" name="sectionId" value={sectionId} />
      <input type="hidden" name="allocations" value={payload} />
      {rows.length ? (
        <ul className="flex flex-col gap-2">
          {rows.map((row, index) => {
            const seats = Number.parseInt(row.capacity, 10) || 0;
            const options = streams.filter((stream) => stream.value === row.streamId || !used.has(stream.value));
            return (
              <li key={index} className="flex flex-col gap-1">
                <div className="flex items-end gap-2">
                  <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs">
                    <span className="text-muted-foreground font-medium">Stream / Group</span>
                    <select
                      className="border-input bg-background h-9 rounded-md border px-2 text-sm"
                      value={row.streamId}
                      onChange={(event) => update(index, { streamId: event.target.value })}
                      disabled={row.occupied > 0}
                      aria-label="Stream / Group"
                    >
                      <option value="">Choose…</option>
                      {options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex w-24 flex-col gap-1 text-xs">
                    <span className="text-muted-foreground font-medium">Seats</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={500}
                      className="border-input bg-background h-9 rounded-md border px-2 text-sm tabular-nums"
                      value={row.capacity}
                      onChange={(event) => update(index, { capacity: event.target.value })}
                      aria-label="Seats"
                    />
                  </label>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-danger hover:bg-danger-soft h-9 rounded-md px-2 disabled:opacity-40"
                    onClick={() => setRows((all) => all.filter((_, i) => i !== index))}
                    disabled={row.occupied > 0}
                    title={row.occupied > 0 ? "Students are placed in this stream; move them first." : "Remove this stream"}
                    aria-label="Remove this stream"
                  >
                    <Trash2Icon className="size-4" aria-hidden />
                  </button>
                </div>
                <p className="text-muted-foreground text-xs">
                  {row.occupied} enrolled · {Math.max(seats - row.occupied, 0)} seat{Math.max(seats - row.occupied, 0) === 1 ? "" : "s"} free
                  {row.occupied > seats ? (
                    <span className="text-warning-strong">
                      {" "}
                      — current enrollment exceeds this by {row.occupied - seats}. Existing students will not be moved automatically.
                    </span>
                  ) : null}
                </p>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">No streams in this section. Add streams to split its {capacity} seats among them — or leave it as one group.</p>
      )}

      {available.length ? (
        <button
          type="button"
          className="text-primary inline-flex w-fit items-center gap-1 text-sm font-medium hover:underline"
          onClick={() => setRows((all) => [...all, { streamId: available[0]!.value, capacity: String(Math.max(capacity - allocated, 0)), occupied: 0 }])}
        >
          <PlusIcon className="size-4" aria-hidden />
          Add stream / group
        </button>
      ) : null}

      <div className="flex flex-col gap-1.5" aria-live="polite">
        <div className="bg-muted h-2 overflow-hidden rounded-full" aria-hidden>
          <div className={over ? "bg-danger h-full" : allocated === capacity ? "bg-success h-full" : "bg-primary h-full"} style={{ width: `${percent}%` }} />
        </div>
        <p className="text-sm tabular-nums">
          <span className="font-semibold">Allocated: {allocated} / {capacity}</span>
          <span className="text-muted-foreground"> · Remaining: {Math.max(capacity - allocated, 0)}</span>
        </p>
        {over ? <p className="text-danger-strong text-sm font-medium">Stream allocation cannot exceed the section&apos;s total capacity.</p> : null}
      </div>

      <div>
        <SubmitButton>Save stream seats</SubmitButton>
      </div>
    </ActionForm>
  );
}
