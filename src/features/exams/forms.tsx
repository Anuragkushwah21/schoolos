"use client";

import { useActionState, useState } from "react";
import { PlusIcon, Trash2Icon } from "lucide-react";

import { ActionForm, useFormContext } from "@/components/forms/action-form";
import { FieldRow, SelectField, SubmitButton, TextField } from "@/components/forms/fields";
import { nativeSelectClass } from "@/components/forms/styles";
import { FieldError } from "@/components/shared/field-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import {
  createClassTestAction,
  createExamAction,
  importMarksAction,
  type ImportResult,
  saveMarksAction,
  updateExamAction,
} from "./actions";

type Option = { value: string; label: string };

// -----------------------------------------------------------------------------
// Creating an exam
// -----------------------------------------------------------------------------

type PaperRow = { key: number; subjectId: string; maxMarks: string; passMarks: string; date: string };

function SectionPicker({ sections }: { sections: Array<Option & { group: string }> }) {
  const { fieldErrors } = useFormContext();
  const groups = [...new Set(sections.map((section) => section.group))];
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">
        Sections<span className="text-destructive">*</span>
      </legend>
      <p className="text-muted-foreground text-xs">
        The same exam and papers are created for every section ticked; each gets its own results.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map((group) => (
          <div key={group} className="rounded-lg border p-3">
            <p className="mb-2 text-sm font-medium">{group}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {sections
                .filter((section) => section.group === group)
                .map((section) => (
                  <label key={section.value} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="sectionIds" value={section.value} className="accent-primary size-4" />
                    {section.label}
                  </label>
                ))}
            </div>
          </div>
        ))}
      </div>
      <FieldError id="sectionIds-error" messages={fieldErrors?.sectionIds} />
    </fieldset>
  );
}

function PaperRows({ subjects }: { subjects: Option[] }) {
  const { fieldErrors } = useFormContext();
  const [rows, setRows] = useState<PaperRow[]>([{ key: 0, subjectId: "", maxMarks: "100", passMarks: "", date: "" }]);
  const update = (key: number, patch: Partial<PaperRow>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const serialised = JSON.stringify(
    rows.map((row) => ({ subjectId: row.subjectId, maxMarks: row.maxMarks, passMarks: row.passMarks, date: row.date })),
  );
  const rowError = (index: number) =>
    Object.entries(fieldErrors ?? {})
      .filter(([key]) => key.startsWith(`papers.${index}.`))
      .flatMap(([, messages]) => messages);

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">
        Papers<span className="text-destructive">*</span>
      </legend>
      <input type="hidden" name="papers" value={serialised} />
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[36rem] text-sm">
          <thead className="bg-muted/40 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Subject</th>
              <th className="w-28 px-3 py-2 font-medium">Max marks</th>
              <th className="w-28 px-3 py-2 font-medium">Pass marks</th>
              <th className="w-40 px-3 py-2 font-medium">Date</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.key} className="border-t align-top">
                <td className="px-3 py-2">
                  <select
                    aria-label={`Subject for paper ${index + 1}`}
                    className={cn(nativeSelectClass, "w-full")}
                    value={row.subjectId}
                    onChange={(event) => update(row.key, { subjectId: event.target.value })}
                  >
                    <option value="">Choose a subject</option>
                    {subjects.map((subject) => (
                      <option key={subject.value} value={subject.value}>
                        {subject.label}
                      </option>
                    ))}
                  </select>
                  <FieldError id={`paper-${row.key}-error`} messages={rowError(index)} />
                </td>
                <td className="px-3 py-2">
                  <Input
                    aria-label="Maximum marks"
                    type="number"
                    min={1}
                    max={1000}
                    value={row.maxMarks}
                    onChange={(event) => update(row.key, { maxMarks: event.target.value })}
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    aria-label="Pass marks"
                    type="number"
                    min={0}
                    placeholder="33%"
                    value={row.passMarks}
                    onChange={(event) => update(row.key, { passMarks: event.target.value })}
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    aria-label="Paper date"
                    type="date"
                    value={row.date}
                    onChange={(event) => update(row.key, { date: event.target.value })}
                  />
                </td>
                <td className="px-1 py-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Remove this paper"
                    disabled={rows.length === 1}
                    onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}
                  >
                    <Trash2Icon className="size-4" aria-hidden />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            setRows((current) => [
              ...current,
              { key: Math.max(...current.map((row) => row.key)) + 1, subjectId: "", maxMarks: "100", passMarks: "", date: "" },
            ])
          }
        >
          <PlusIcon className="size-4" aria-hidden />
          Add subject
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        Leave pass marks blank for 33% of the maximum. A paper without a date is dated the exam&apos;s first day.
      </p>
      <FieldError id="papers-error" messages={fieldErrors?.papers} />
    </fieldset>
  );
}

export function CreateExamForm({
  sections,
  subjects,
}: {
  sections: Array<Option & { group: string }>;
  subjects: Option[];
}) {
  return (
    <ActionForm action={createExamAction} className="max-w-4xl">
      <TextField name="name" label="Exam name" placeholder="Half-Yearly Examination" required />
      <FieldRow>
        <TextField name="startDate" label="From" type="date" required />
        <TextField name="endDate" label="To" type="date" required />
      </FieldRow>
      <SectionPicker sections={sections} />
      <PaperRows subjects={subjects} />
      <div>
        <SubmitButton>Create exam</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function EditExamForm({
  exam,
}: {
  exam: { id: string; name: string; startDate: string; endDate: string };
}) {
  return (
    <ActionForm action={updateExamAction} className="max-w-3xl">
      <input type="hidden" name="examId" value={exam.id} />
      <TextField name="name" label="Exam name" defaultValue={exam.name} required />
      <FieldRow>
        <TextField name="startDate" label="From" type="date" defaultValue={exam.startDate} required />
        <TextField name="endDate" label="To" type="date" defaultValue={exam.endDate} required />
      </FieldRow>
      <div>
        <SubmitButton>Save</SubmitButton>
      </div>
    </ActionForm>
  );
}

// -----------------------------------------------------------------------------
// Entering marks
// -----------------------------------------------------------------------------

type MarksRow = {
  studentId: string;
  name: string;
  admissionNumber: string;
  rollNumber: string | null;
  marksObtained: number | null;
  absent: boolean;
  remark: string | null;
};

function MarksRowView({ row, maxMarks, editable }: { row: MarksRow; maxMarks: number; editable: boolean }) {
  const { fieldErrors } = useFormContext();
  const [absent, setAbsent] = useState(row.absent);
  const errors = fieldErrors?.[`marks:${row.studentId}`];
  return (
    <tr className="border-t align-top">
      <td className="px-3 py-2">
        <input type="hidden" name={`row:${row.studentId}`} value="1" />
        <span className="font-medium">{row.name}</span>
        <span className="text-muted-foreground block text-xs">
          {[row.rollNumber ? `Roll ${row.rollNumber}` : null, row.admissionNumber].filter(Boolean).join(" · ")}
        </span>
      </td>
      <td className="px-3 py-2">
        <Input
          name={`marks:${row.studentId}`}
          aria-label={`Marks for ${row.name}`}
          aria-invalid={errors?.length ? true : undefined}
          type="number"
          inputMode="numeric"
          min={0}
          max={maxMarks}
          defaultValue={row.marksObtained ?? ""}
          disabled={!editable || absent}
          className="w-24"
        />
        <FieldError id={`marks-${row.studentId}-error`} messages={errors} />
      </td>
      <td className="px-3 py-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name={`absent:${row.studentId}`}
            defaultChecked={row.absent}
            disabled={!editable}
            onChange={(event) => setAbsent(event.currentTarget.checked)}
            className="accent-primary size-4"
          />
          Absent
        </label>
      </td>
      <td className="px-3 py-2">
        <Input
          name={`remark:${row.studentId}`}
          aria-label={`Remark for ${row.name}`}
          defaultValue={row.remark ?? ""}
          maxLength={300}
          disabled={!editable}
          placeholder="Optional"
        />
      </td>
    </tr>
  );
}

export function MarksSheetForm({
  assessmentId,
  maxMarks,
  rows,
  editable,
}: {
  assessmentId: string;
  maxMarks: number;
  rows: MarksRow[];
  editable: boolean;
}) {
  return (
    <ActionForm action={saveMarksAction}>
      <input type="hidden" name="assessmentId" value={assessmentId} />
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="bg-muted/40 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Student</th>
              <th className="w-32 px-3 py-2 font-medium">Marks / {maxMarks}</th>
              <th className="w-28 px-3 py-2 font-medium">Attendance</th>
              <th className="px-3 py-2 font-medium">Remark</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <MarksRowView key={row.studentId} row={row} maxMarks={maxMarks} editable={editable} />
            ))}
          </tbody>
        </table>
      </div>
      {editable ? (
        <div className="flex items-center gap-3">
          <SubmitButton pendingLabel="Saving…">Save marks</SubmitButton>
          <p className="text-muted-foreground text-xs">A row left blank, not absent and without a remark is not saved.</p>
        </div>
      ) : null}
    </ActionForm>
  );
}

/** Upload a filled-in template. Row errors are listed; nothing is saved until all rows pass. */
export function ImportMarksForm({ assessmentId }: { assessmentId: string }) {
  const [state, dispatch, pending] = useActionState<ImportResult, FormData>(importMarksAction, { status: "idle" });
  const errors = state.status === "error" ? Object.entries(state.fieldErrors ?? {}) : [];
  return (
    <form action={dispatch} className="flex flex-col gap-3">
      <input type="hidden" name="assessmentId" value={assessmentId} />
      <div className="flex flex-wrap items-center gap-2">
        <Input type="file" name="file" accept=".csv,text/csv" required className="max-w-xs" aria-label="Marks CSV file" />
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "Importing…" : "Import CSV"}
        </Button>
      </div>
      {state.status === "success" ? (
        <p role="status" className="text-sm text-success-strong">
          {state.message}
        </p>
      ) : null}
      {state.status === "error" ? (
        <div role="alert" className="border-destructive/30 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm">
          <p>{state.message}</p>
          {errors.length ? (
            <ul className="mt-1 list-disc pl-5">
              {errors.slice(0, 50).map(([line, messages]) => (
                <li key={line}>
                  {line.replace(/^line/, "Row")}: {messages[0]}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}

// -----------------------------------------------------------------------------
// Class tests (teacher)
// -----------------------------------------------------------------------------

export function ClassTestForm({ options, today }: { options: Option[]; today: string }) {
  const [pair, setPair] = useState(options[0]?.value ?? "");
  const [sectionId, subjectId] = pair.split("|");
  return (
    <ActionForm action={createClassTestAction} className="max-w-3xl">
      <input type="hidden" name="sectionId" value={sectionId ?? ""} />
      <input type="hidden" name="subjectId" value={subjectId ?? ""} />
      <FieldRow>
        <SelectField
          name="pair"
          label="Class and subject"
          value={pair}
          onChange={(event) => setPair(event.target.value)}
          options={options}
          required
        />
        <TextField name="name" label="Test name" placeholder="Unit Test 2" required />
      </FieldRow>
      <FieldRow>
        <TextField name="date" label="Date" type="date" defaultValue={today} required />
        <FieldRow>
          <TextField name="maxMarks" label="Max marks" type="number" min={1} max={1000} defaultValue="25" required />
          <TextField name="passMarks" label="Pass marks" type="number" min={0} hint="Blank = 33%" />
        </FieldRow>
      </FieldRow>
      <div>
        <SubmitButton>Create test</SubmitButton>
      </div>
    </ActionForm>
  );
}
