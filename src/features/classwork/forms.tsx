"use client";

import { useRef, useState } from "react";

import { ActionForm } from "@/components/forms/action-form";
import {
  FieldRow,
  SelectField,
  SubmitButton,
  TextField,
  TextareaField,
} from "@/components/forms/fields";
import { ActionButton } from "@/components/forms/action-button";
import { Button } from "@/components/ui/button";
import {
  addHomeworkResourceAction,
  addLessonMaterialAction,
  addRemarkAction,
  planLessonAction,
  recordActivityAction,
  removeHomeworkResourceAction,
  saveHomeworkAction,
  updateHomeworkResourceAction,
  updateRemarkAction,
} from "@/features/classwork/actions";
import type { DayOfWeek } from "@/generated/prisma/enums";
import { dayOfWeek, parseDateInput } from "@/lib/dates";

/**
 * The forms a teacher fills in.
 *
 * Each takes plain serialised values — ids and `YYYY-MM-DD` strings — never a
 * Prisma row, so nothing about the database shape reaches the browser. The
 * options are the teacher's own classes, but that is presentation: the server
 * checks the assignment again whatever is posted.
 *
 * Where a field narrows another — the date narrows which periods exist, the
 * class narrows which subjects the teacher may set work in — the narrowing is
 * done here in the browser as well. Not for safety, which the server provides,
 * but so the form cannot offer a combination that would come back refused.
 */

export type SlotOption = {
  value: string;
  label: string;
};

const ACTIVITY_STATUS_OPTIONS = [
  { value: "COMPLETED", label: "Completed" },
  { value: "SUBSTITUTE", label: "Taken by a substitute" },
  { value: "REMOTE", label: "Held remotely" },
  { value: "MISSED", label: "Missed" },
  { value: "CANCELLED", label: "Cancelled" },
];

/** A period, with the weekday it falls on so the date can filter it. */
export type PeriodOption = SlotOption & { dayOfWeek: DayOfWeek };

export function ClassActivityForm({
  slots,
  defaultSlotId,
  defaultDate,
  earliestDate,
  activity,
}: {
  slots: PeriodOption[];
  defaultSlotId?: string;
  defaultDate: string;
  /** The oldest day still inside the correction window. */
  earliestDate?: string;
  activity?: {
    timetableSlotId: string;
    date: string;
    status: string;
    topic: string | null;
    notes: string | null;
    importantPoints: string | null;
    preparation?: string | null;
    homework?: { title: string; description: string | null; dueOn: string } | null;
  };
}) {
  const [date, setDate] = useState(activity?.date ?? defaultDate);

  // A period belongs to one weekday. Offering Monday's periods against a
  // Wednesday is the one mistake this form could otherwise invite, so the date
  // decides the list rather than warning about it afterwards.
  const parsed = parseDateInput(date);
  const onDay = parsed ? slots.filter((slot) => slot.dayOfWeek === dayOfWeek(parsed)) : slots;

  return (
    <ActionForm action={recordActivityAction} resetOnSuccess={!activity}>
      <FieldRow>
        <TextField
          name="date"
          label="Date"
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          min={earliestDate}
          max={defaultDate}
          required
        />
        <SelectField
          // Remounted when the day changes, so a period left over from another
          // weekday is not still selected behind a list that no longer has it.
          key={onDay.map((slot) => slot.value).join(",")}
          name="timetableSlotId"
          label="Period"
          defaultValue={activity?.timetableSlotId ?? defaultSlotId}
          options={onDay}
          placeholder={onDay.length ? "Choose a period" : "Nothing scheduled that day"}
          disabled={onDay.length === 0}
          required
        />
      </FieldRow>
      <SelectField
        name="status"
        label="What happened"
        defaultValue={activity?.status ?? "COMPLETED"}
        options={ACTIVITY_STATUS_OPTIONS}
        required
      />
      <TextField
        name="topic"
        label="Topic"
        defaultValue={activity?.topic ?? ""}
        placeholder="Quadratic equations"
        hint="What you taught. This is the line a parent report quotes."
      />
      <TextareaField
        name="notes"
        label="Class notes"
        rows={4}
        defaultValue={activity?.notes ?? ""}
        hint="What you covered, in your own words. Your class and their parents can read this."
      />
      <TextareaField
        name="importantPoints"
        label="Important points"
        rows={3}
        defaultValue={activity?.importantPoints ?? ""}
        placeholder="Practice questions 1-10. Learn the formula."
        hint="The short list a student revises from."
      />
      <TextareaField
        name="preparation"
        label="Preparation instructions"
        rows={2}
        defaultValue={activity?.preparation ?? ""}
        placeholder="Read chapter 5 before the next class."
        hint="What students should do before the next class."
      />
      <fieldset className="flex flex-col gap-4 rounded-lg border p-4">
        <legend className="px-1 text-sm font-medium">Homework (optional)</legend>
        <FieldRow>
          <TextField
            name="homeworkTitle"
            label="Homework"
            defaultValue={activity?.homework?.title ?? ""}
            placeholder="Exercise 4.2, questions 1-8"
          />
          <TextField
            name="homeworkDueOn"
            label="Due on"
            type="date"
            min={date}
            defaultValue={activity?.homework?.dueOn ?? ""}
          />
        </FieldRow>
        <TextareaField
          name="homeworkDescription"
          label="Details"
          rows={2}
          defaultValue={activity?.homework?.description ?? ""}
          hint="Appears on your class's homework list, due on the date above."
        />
      </fieldset>
      <div>
        <SubmitButton pendingLabel="Saving…">
          {activity ? "Update record" : "Record class"}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

const HOMEWORK_STATUS_OPTIONS = [
  { value: "PUBLISHED", label: "Set for the class" },
  { value: "DRAFT", label: "Draft — not visible yet" },
];

/** A class the teacher may set work for, with the subjects they teach it. */
export type HomeworkSectionOption = SlotOption & { subjects: SlotOption[] };

export function HomeworkForm({
  sections,
  today,
  homework,
}: {
  sections: HomeworkSectionOption[];
  today: string;
  homework?: {
    id: string;
    sectionId: string;
    subjectId: string;
    title: string;
    description: string | null;
    instructions?: string | null;
    assignedOn: string;
    dueOn: string;
    status: string;
  };
}) {
  const [sectionId, setSectionId] = useState(homework?.sectionId ?? sections[0]?.value ?? "");
  const [hasUpload, setHasUpload] = useState(false);
  // Work cannot be due before it is set; the server enforces the same rule.
  const [assignedOn, setAssignedOn] = useState(homework?.assignedOn ?? today);
  const subjects = sections.find((section) => section.value === sectionId)?.subjects ?? [];

  return (
    <ActionForm action={saveHomeworkAction} className="max-w-3xl">
      {homework ? <input type="hidden" name="homeworkId" value={homework.id} /> : null}
      <FieldRow>
        <SelectField
          name="sectionId"
          label="Class"
          value={sectionId}
          onChange={(event) => setSectionId(event.target.value)}
          options={sections}
          placeholder={sectionId ? undefined : "Choose a class"}
          required
        />
        <SelectField
          // The subject list changes with the class, so the previous choice
          // must not survive as a stale selection.
          key={sectionId}
          name="subjectId"
          label="Subject"
          defaultValue={homework?.sectionId === sectionId ? homework.subjectId : undefined}
          options={subjects}
          placeholder={subjects.length ? "Choose a subject" : "You teach no subject here"}
          disabled={subjects.length === 0}
          hint="Only the subjects you are assigned to this class."
          required
        />
      </FieldRow>
      <TextField
        name="title"
        label="Title"
        defaultValue={homework?.title}
        placeholder="Exercise 4.2 — Q1 to Q5"
        required
      />
      <TextareaField
        name="description"
        label="Details"
        rows={5}
        defaultValue={homework?.description ?? ""}
        hint="What the homework is about."
      />
      <TextareaField
        name="instructions"
        label="Homework instructions"
        rows={4}
        defaultValue={homework?.instructions ?? ""}
        placeholder="Complete Exercise 4.2, Questions 1-10."
        hint="Exactly what the student needs to do."
      />
      <FieldRow>
        <TextField
          name="assignedOn"
          label="Set on"
          type="date"
          defaultValue={homework?.assignedOn ?? today}
          onChange={(event) => setAssignedOn(event.currentTarget.value)}
          required
        />
        <TextField
          name="dueOn"
          label="Due on"
          type="date"
          defaultValue={homework?.dueOn ?? today}
          min={assignedOn || undefined}
          required
        />
      </FieldRow>
      <SelectField
        name="status"
        label="Status"
        defaultValue={homework?.status ?? "PUBLISHED"}
        options={HOMEWORK_STATUS_OPTIONS}
        required
      />
      {homework ? null : <HomeworkResourceBuilder onUploadChange={setHasUpload} />}
      <div>
        <SubmitButton pendingLabel={hasUpload ? "Uploading…" : "Saving…"}>
          {homework ? "Save homework" : "Set homework"}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

// -----------------------------------------------------------------------------
// Homework study resources
// -----------------------------------------------------------------------------

const RESOURCE_TYPES = [
  { value: "DOCUMENT", label: "PDF / Document" },
  { value: "VIDEO", label: "Video link" },
  { value: "LINK", label: "External link" },
] as const;

type ResourceType = (typeof RESOURCE_TYPES)[number]["value"];

/** Checked here only so the teacher hears at once; the server checks again. */
function pdfProblem(file: File | undefined): string | null {
  if (!file) return null;
  if (!/\.pdf$/i.test(file.name)) return "Only PDF files can be uploaded.";
  if (file.size > MAX_UPLOAD_BYTES) return "That file is larger than 10 MB. Choose a smaller PDF.";
  return null;
}

/** The fields for one resource, named with `prefix` (e.g. `resources.3.`). */
function ResourceFields({
  prefix,
  type,
  onFileChange,
}: {
  prefix: string;
  type: ResourceType;
  onFileChange?: (hasFile: boolean) => void;
}) {
  const [fileError, setFileError] = useState<string | null>(null);

  return (
    <>
      <TextField
        name={`${prefix}title`}
        label="Title"
        placeholder={
          type === "DOCUMENT"
            ? "Chapter notes"
            : type === "VIDEO"
              ? "Quadratic equations explanation"
              : "Practice questions"
        }
        required
      />
      {type === "DOCUMENT" ? (
        <TextField
          name={`${prefix}file`}
          label="Upload PDF"
          type="file"
          accept=".pdf,application/pdf"
          hint={fileError ?? "PDF only, up to 10 MB."}
          onChange={(event) => {
            const input = event.currentTarget;
            const problem = pdfProblem(input.files?.[0]);
            setFileError(problem);
            if (problem) input.value = "";
            onFileChange?.(Boolean(input.files?.length));
          }}
          required
        />
      ) : (
        <TextField
          name={`${prefix}url`}
          label={type === "VIDEO" ? "Video URL" : "URL"}
          type="url"
          placeholder={type === "VIDEO" ? "https://www.youtube.com/watch?v=…" : "https://…"}
          hint="An https:// link. Only the address is stored."
          required
        />
      )}
      <TextField name={`${prefix}description`} label="Description (optional)" />
    </>
  );
}

/**
 * Any number of resources, added and removed before the homework is saved.
 *
 * Each row has a stable number, so removing the second of three does not
 * renumber the third while the teacher is typing in it.
 */
function HomeworkResourceBuilder({ onUploadChange }: { onUploadChange: (value: boolean) => void }) {
  const next = useRef(0);
  const [rows, setRows] = useState<Array<{ id: number; type: ResourceType; hasFile: boolean }>>([]);

  function update(nextRows: typeof rows) {
    setRows(nextRows);
    onUploadChange(nextRows.some((row) => row.type === "DOCUMENT" && row.hasFile));
  }

  return (
    <fieldset className="flex flex-col gap-4 rounded-lg border p-4">
      <legend className="px-1 text-sm font-medium">Study resources (optional)</legend>
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Attach PDFs, videos or links the class should use for this homework.
        </p>
      ) : null}
      {rows.map((row, position) => (
        <div key={row.id} className="bg-muted/30 flex flex-col gap-3 rounded-lg border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium">Resource {position + 1}</span>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => update(rows.filter((other) => other.id !== row.id))}
            >
              Remove
            </Button>
          </div>
          <div role="radiogroup" aria-label="Resource type" className="flex flex-wrap gap-4 text-sm">
            {RESOURCE_TYPES.map((option) => (
              <label key={option.value} className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name={`resources.${row.id}.kind`}
                  value={option.value}
                  checked={row.type === option.value}
                  onChange={() =>
                    update(
                      rows.map((other) =>
                        other.id === row.id ? { ...other, type: option.value, hasFile: false } : other,
                      ),
                    )
                  }
                />
                {option.label}
              </label>
            ))}
          </div>
          <ResourceFields
            // Remounted on a type change, so a PDF picked for "document" is not
            // posted after switching to "video".
            key={row.type}
            prefix={`resources.${row.id}.`}
            type={row.type}
            onFileChange={(hasFile) =>
              update(rows.map((other) => (other.id === row.id ? { ...other, hasFile } : other)))
            }
          />
        </div>
      ))}
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={rows.length >= 20}
          onClick={() => update([...rows, { id: next.current++, type: "DOCUMENT", hasFile: false }])}
        >
          + {rows.length ? "Add another resource" : "Add resource"}
        </Button>
      </div>
    </fieldset>
  );
}

/** Add one resource to homework that already exists. */
export function AddHomeworkResourceForm({ homeworkId }: { homeworkId: string }) {
  const [type, setType] = useState<ResourceType>("DOCUMENT");

  return (
    <ActionForm action={addHomeworkResourceAction} resetOnSuccess className="gap-3">
      <input type="hidden" name="homeworkId" value={homeworkId} />
      <SelectField
        name="kind"
        label="Resource type"
        value={type}
        onChange={(event) => setType(event.target.value as ResourceType)}
        options={RESOURCE_TYPES.map((option) => ({ value: option.value, label: option.label }))}
        required
      />
      <ResourceFields key={type} prefix="" type={type} />
      <div>
        <SubmitButton variant="outline" pendingLabel={type === "DOCUMENT" ? "Uploading…" : "Saving…"}>
          Add resource
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

/**
 * Edit one existing resource: its title and description, the address of a
 * video or link, or a replacement PDF. Removing it leaves the homework alone.
 */
export function HomeworkResourceEditor({
  resource,
}: {
  resource: {
    id: string;
    kind: string;
    title: string;
    url: string | null;
    description: string | null;
    fileName: string | null;
  };
}) {
  const [fileError, setFileError] = useState<string | null>(null);
  const uploaded = Boolean(resource.fileName);

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <ActionForm action={updateHomeworkResourceAction} className="gap-3">
        <input type="hidden" name="resourceId" value={resource.id} />
        <FieldRow>
          <TextField name="title" label="Title" defaultValue={resource.title} required />
          <TextField name="description" label="Description" defaultValue={resource.description ?? ""} />
        </FieldRow>
        {uploaded ? (
          <TextField
            name="file"
            label={`Replace PDF (now: ${resource.fileName})`}
            type="file"
            accept=".pdf,application/pdf"
            hint={fileError ?? "Leave empty to keep the current file."}
            onChange={(event) => {
              const input = event.currentTarget;
              const problem = pdfProblem(input.files?.[0]);
              setFileError(problem);
              if (problem) input.value = "";
            }}
          />
        ) : (
          <TextField
            name="url"
            label={resource.kind === "VIDEO" ? "Video URL" : "URL"}
            type="url"
            defaultValue={resource.url ?? ""}
            required
          />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <SubmitButton variant="outline" size="sm" pendingLabel={uploaded ? "Uploading…" : "Saving…"}>
            Save resource
          </SubmitButton>
          {uploaded ? (
            <a
              href={`/api/v1/lesson-materials/${resource.id}/file`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary text-xs hover:underline"
            >
              View current PDF
            </a>
          ) : null}
        </div>
      </ActionForm>
      <div>
        <ActionButton
          action={removeHomeworkResourceAction}
          fields={{ resourceId: resource.id }}
          variant="ghost"
          size="xs"
          pendingLabel="Removing…"
          confirm={{
            title: "Remove this resource?",
            description: "Only the resource is removed; the homework stays as it is.",
            confirmLabel: "Remove",
          }}
        >
          Remove resource
        </ActionButton>
      </div>
    </div>
  );
}

/**
 * The three questions every remark answers, in one place.
 *
 * The labels are the parent's words, not the database's: a guardian reading
 * "Needs attention" understands it, "NEEDS_ATTENTION" is a column value.
 */
const UNDERSTANDING_OPTIONS = [
  { value: "GOOD", label: "Good" },
  { value: "AVERAGE", label: "Average" },
  { value: "NEEDS_ATTENTION", label: "Needs attention" },
];

const HOMEWORK_OPTIONS = [
  { value: "REGULAR", label: "Regular" },
  { value: "SOMETIMES_MISSING", label: "Sometimes missing" },
  { value: "FREQUENTLY_MISSING", label: "Frequently missing" },
];

const PARTICIPATION_OPTIONS = [
  { value: "ACTIVE", label: "Active" },
  { value: "AVERAGE", label: "Average" },
  { value: "NEEDS_IMPROVEMENT", label: "Needs improvement" },
];

export type RemarkBandValues = {
  understanding: string | null;
  homeworkHabit: string | null;
  participation: string | null;
  note: string | null;
};

/** Every field optional; the action refuses a remark that says nothing. */
function RemarkBandFields({ d }: { d?: RemarkBandValues }) {
  return (
    <>
      <FieldRow>
        <SelectField
          name="understanding"
          label="Academic understanding"
          options={UNDERSTANDING_OPTIONS}
          defaultValue={d?.understanding ?? ""}
          placeholder="Not assessed"
        />
        <SelectField
          name="homeworkHabit"
          label="Homework"
          options={HOMEWORK_OPTIONS}
          defaultValue={d?.homeworkHabit ?? ""}
          placeholder="Not assessed"
        />
      </FieldRow>
      <SelectField
        name="participation"
        label="Participation"
        options={PARTICIPATION_OPTIONS}
        defaultValue={d?.participation ?? ""}
        placeholder="Not assessed"
      />
      <TextareaField
        name="note"
        label="Note"
        rows={3}
        defaultValue={d?.note ?? ""}
        placeholder="Needs more practice with fractions."
        hint="Optional, and read by the child's parents. Answer at least one question above, or write a note."
      />
    </>
  );
}

export function RemarkForm({
  studentId,
  subjects,
}: {
  studentId: string;
  subjects: SlotOption[];
}) {
  return (
    <ActionForm action={addRemarkAction} resetOnSuccess>
      <input type="hidden" name="studentId" value={studentId} />
      <RemarkBandFields />
      {subjects.length ? (
        <SelectField
          name="subjectId"
          label="Subject"
          options={subjects}
          placeholder="No particular subject"
        />
      ) : null}
      <div>
        <SubmitButton>Add remark</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function EditRemarkForm({
  remarkId,
  remark,
}: {
  remarkId: string;
  remark: RemarkBandValues;
}) {
  return (
    <ActionForm action={updateRemarkAction}>
      <input type="hidden" name="remarkId" value={remarkId} />
      <RemarkBandFields d={remark} />
      <div>
        <SubmitButton size="sm">Save remark</SubmitButton>
      </div>
    </ActionForm>
  );
}

const MATERIAL_KIND_OPTIONS = [
  { value: "NOTES", label: "Notes" },
  { value: "QUESTIONS", label: "Important questions" },
  { value: "PRACTICE", label: "Practice work" },
  { value: "DOCUMENT", label: "PDF / document" },
  { value: "VIDEO", label: "Video link" },
  { value: "LINK", label: "External resource link" },
];
const URL_KINDS = ["LINK", "DOCUMENT", "VIDEO"];

/** Mirrors `MAX_DOCUMENT_BYTES`; checked here only so a teacher hears at once. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * Planning a lesson the class has not sat yet.
 *
 * Writes onto the same period row the teacher will later write the class up on,
 * which is why this form addresses a period and a date rather than a "lesson id".
 */
export function LessonPlanForm({
  slots,
  earliestDate,
  latestDate,
  defaultDate,
}: {
  slots: PeriodOption[];
  /** Today: a lesson cannot be planned for a day that has passed. */
  earliestDate: string;
  latestDate: string;
  defaultDate: string;
}) {
  const [date, setDate] = useState(defaultDate);

  const parsed = parseDateInput(date);
  const onDay = parsed ? slots.filter((slot) => slot.dayOfWeek === dayOfWeek(parsed)) : slots;

  return (
    <ActionForm action={planLessonAction} resetOnSuccess>
      <FieldRow>
        <TextField
          name="date"
          label="Date"
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          min={earliestDate}
          max={latestDate}
          required
        />
        <SelectField
          key={onDay.map((slot) => slot.value).join(",")}
          name="timetableSlotId"
          label="Period"
          options={onDay}
          placeholder={onDay.length ? "Choose a period" : "Nothing scheduled that day"}
          disabled={onDay.length === 0}
          required
        />
      </FieldRow>
      <TextField
        name="plannedTopic"
        label="Planned topic"
        placeholder="Quadratic equations — practice"
        hint="What you intend to cover. Your class sees this as an upcoming lesson."
      />
      <TextareaField
        name="preparation"
        label="What to prepare"
        rows={3}
        placeholder="Review the notes from the last class."
        hint="Optional, but it is the part that makes the plan useful to a student."
      />
      <div>
        <SubmitButton pendingLabel="Planning…">Plan lesson</SubmitButton>
      </div>
    </ActionForm>
  );
}

/**
 * Attaching notes, a link, a document or practice work to one lesson.
 *
 * The kind decides which of the two fields is used, and the other is hidden —
 * a document with a block of notes behind it is a row nobody can interpret.
 */
export function LessonMaterialForm({ classSessionId }: { classSessionId: string }) {
  const [kind, setKind] = useState("NOTES");
  const [fileError, setFileError] = useState<string | null>(null);
  const wantsUrl = URL_KINDS.includes(kind);

  return (
    <ActionForm action={addLessonMaterialAction} resetOnSuccess className="gap-4">
      <input type="hidden" name="classSessionId" value={classSessionId} />
      <FieldRow>
        <SelectField
          name="kind"
          label="Kind"
          value={kind}
          onChange={(event) => setKind(event.target.value)}
          options={MATERIAL_KIND_OPTIONS}
          required
        />
        <TextField
          name="title"
          label="Title"
          placeholder={kind === "VIDEO" ? "Quadratic equations explained" : "Chapter 4 notes"}
          required
        />
      </FieldRow>
      {kind === "DOCUMENT" ? (
        <>
          <TextField
            name="file"
            label="Upload PDF"
            type="file"
            accept=".pdf,application/pdf"
            hint={fileError ?? "PDF only, up to 10 MB. Or give a web address below instead."}
            onChange={(event) => {
              const input = event.currentTarget;
              const file = input.files?.[0];
              if (file && file.size > MAX_UPLOAD_BYTES) {
                setFileError("That file is larger than 10 MB. Choose a smaller PDF.");
                input.value = "";
                return;
              }
              if (file && !/\.pdf$/i.test(file.name)) {
                setFileError("Only PDF files can be uploaded.");
                input.value = "";
                return;
              }
              setFileError(null);
            }}
          />
          <TextField
            name="url"
            label="…or web address"
            type="url"
            placeholder="https://…"
          />
        </>
      ) : wantsUrl ? (
        <TextField
          name="url"
          label={kind === "VIDEO" ? "Video address" : "Web address"}
          type="url"
          placeholder={kind === "VIDEO" ? "https://www.youtube.com/watch?v=…" : "https://…"}
          hint="An https:// link. Only the address is stored."
          required
        />
      ) : (
        <TextareaField
          name="body"
          label="Content"
          rows={5}
          placeholder="Type the notes, questions or practice work here."
          required
        />
      )}
      {wantsUrl ? (
        <TextField name="description" label="Description" placeholder="What students should use it for" />
      ) : null}
      <div>
        <SubmitButton variant="outline" pendingLabel={kind === "DOCUMENT" ? "Uploading…" : "Saving…"}>
          Add material
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
