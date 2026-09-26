"use client";

import { useState } from "react";

import { ActionForm } from "@/components/forms/action-form";
import {
  FieldRow,
  SelectField,
  SubmitButton,
  TextField,
  TextareaField,
} from "@/components/forms/fields";
import {
  addLessonMaterialAction,
  addRemarkAction,
  planLessonAction,
  recordActivityAction,
  saveHomeworkAction,
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
    assignedOn: string;
    dueOn: string;
    status: string;
  };
}) {
  const [sectionId, setSectionId] = useState(homework?.sectionId ?? sections[0]?.value ?? "");
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
        hint="What to do, and anything the class needs to know."
      />
      <FieldRow>
        <TextField
          name="assignedOn"
          label="Set on"
          type="date"
          defaultValue={homework?.assignedOn ?? today}
          required
        />
        <TextField
          name="dueOn"
          label="Due on"
          type="date"
          defaultValue={homework?.dueOn ?? today}
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
      <div>
        <SubmitButton>{homework ? "Save homework" : "Set homework"}</SubmitButton>
      </div>
    </ActionForm>
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
  { value: "LINK", label: "Link" },
  { value: "DOCUMENT", label: "Document" },
];

/** Kinds that take a web address instead of text. */
const URL_KINDS = ["LINK", "DOCUMENT"];

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
        <TextField name="title" label="Title" placeholder="Chapter 4 notes" required />
      </FieldRow>
      {wantsUrl ? (
        <TextField
          name="url"
          label="Web address"
          type="url"
          placeholder="https://…"
          hint="An https:// link. There is no file upload in this version."
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
      <div>
        <SubmitButton variant="outline" pendingLabel="Adding…">
          Add material
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
