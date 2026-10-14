"use client";

import { useActionState, useState } from "react";
import { PlusIcon, Trash2Icon } from "lucide-react";

import { ActionForm, useFormContext } from "@/components/forms/action-form";
import { FieldRow, SelectField, SubmitButton, TextareaField, TextField } from "@/components/forms/fields";
import { nativeSelectClass } from "@/components/forms/styles";
import { FieldError } from "@/components/shared/field-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import {
  correctResultAction,
  createClassTestAction,
  createExamAction,
  importMarksAction,
  type ImportResult,
  reopenMarksAction,
  saveGradingRulesAction,
  saveMarksAction,
  saveResultSchemeAction,
  updateClassTestAction,
  unpublishExamAction,
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
  exempt?: boolean;
  remark: string | null;
};

const ENTRY_BADGE = {
  ENTERED: "bg-success-soft text-success-strong",
  ABSENT: "bg-muted text-muted-foreground",
  EXEMPT: "bg-info-soft text-info-strong",
  MISSING: "bg-warning-soft text-warning-strong",
  INVALID: "bg-danger-soft text-danger-strong",
} as const;

function MarksRowView({ row, maxMarks, editable }: { row: MarksRow; maxMarks: number; editable: boolean }) {
  const { fieldErrors } = useFormContext();
  const [mode, setMode] = useState<"MARKS" | "ABSENT" | "EXEMPT">(row.exempt ? "EXEMPT" : row.absent ? "ABSENT" : "MARKS");
  const absent = mode !== "MARKS";
  const [marks, setMarks] = useState(row.marksObtained === null ? "" : String(row.marksObtained));
  const errors = fieldErrors?.[`marks:${row.studentId}`];
  const number = marks.trim() === "" ? null : Number(marks);
  const invalid = number !== null && (!Number.isInteger(number) || number < 0 || number > maxMarks);
  const status = mode === "EXEMPT" ? "EXEMPT" : absent ? "ABSENT" : invalid ? "INVALID" : number === null ? "MISSING" : "ENTERED";
  const percent = !absent && number !== null && !invalid && maxMarks ? Math.round((number / maxMarks) * 1000) / 10 : null;
  return (
    <tr className="border-t align-top">
      <td className="px-3 py-2">
        <input type="hidden" name={`row:${row.studentId}`} value="1" />
        <span className="font-medium">{row.name}</span>
        {row.rollNumber ? <span className="text-muted-foreground block text-xs">Roll {row.rollNumber}</span> : null}
      </td>
      <td className="text-muted-foreground px-3 py-2 tabular-nums">{row.admissionNumber}</td>
      <td className="px-3 py-2">
        <Input
          name={`marks:${row.studentId}`}
          aria-label={`Marks for ${row.name}, out of ${maxMarks}`}
          aria-invalid={errors?.length || invalid ? true : undefined}
          type="number"
          inputMode="numeric"
          min={0}
          max={maxMarks}
          value={absent ? "" : marks}
          onChange={(event) => setMarks(event.currentTarget.value)}
          disabled={!editable || absent}
          className="w-24"
        />
        {invalid ? <span className="text-danger-strong mt-1 block text-xs">0 to {maxMarks} only</span> : null}
        <FieldError id={`marks-${row.studentId}-error`} messages={errors} />
        <select
          name={`status:${row.studentId}`}
          aria-label={`Status for ${row.name}`}
          value={mode}
          disabled={!editable}
          onChange={(event) => setMode(event.currentTarget.value as "MARKS" | "ABSENT" | "EXEMPT")}
          className="border-input bg-background mt-1.5 block rounded-md border px-1.5 py-0.5 text-xs"
        >
          <option value="MARKS">Marks</option>
          <option value="ABSENT">Absent</option>
          <option value="EXEMPT">Exempt</option>
        </select>
      </td>
      <td className="px-3 py-2 tabular-nums">{percent === null ? "—" : `${percent}%`}</td>
      <td className="px-3 py-2">
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${ENTRY_BADGE[status]}`}>
          {status === "ENTERED" ? "Entered" : status === "ABSENT" ? "Absent" : status === "EXEMPT" ? "Exempt" : status === "INVALID" ? "Check marks" : "Missing"}
        </span>
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

/**
 * The marks sheet: Student | Admission no. | Marks | Percentage | Status.
 * "Save draft" keeps the marks private; "Submit results" saves and hands them
 * in — every student needs a mark or Absent — after which they lock.
 */
export function MarksSheetForm({
  assessmentId,
  maxMarks,
  rows,
  editable,
  canSubmit,
  submitHint,
}: {
  assessmentId: string;
  maxMarks: number;
  rows: MarksRow[];
  editable: boolean;
  canSubmit?: boolean;
  submitHint?: string;
}) {
  return (
    <ActionForm action={saveMarksAction}>
      <input type="hidden" name="assessmentId" value={assessmentId} />
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[44rem] text-sm">
          <thead className="bg-muted/60 text-muted-foreground text-left text-xs uppercase">
            <tr>
              <th className="px-3 py-2 font-semibold">Student</th>
              <th className="px-3 py-2 font-semibold">Admission no.</th>
              <th className="w-36 px-3 py-2 font-semibold">Marks / {maxMarks}</th>
              <th className="w-24 px-3 py-2 font-semibold">Percentage</th>
              <th className="w-28 px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 font-semibold">Remark</th>
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
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton name="intent" value="save" variant="outline" pendingLabel="Saving…">
            Save draft
          </SubmitButton>
          {canSubmit ? (
            <SubmitButton name="intent" value="submit" pendingLabel="Submitting…">
              Submit results
            </SubmitButton>
          ) : null}
          <p className="text-muted-foreground text-xs">{submitHint ?? "Save a draft as often as you like. Submitting locks the marks."}</p>
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
// Tests (teacher)
// -----------------------------------------------------------------------------

export type TestOption = {
  value: string;
  sectionId: string;
  subjectId: string;
  streamId: string | null;
  subject: string;
  className: string;
  section: string;
  stream: string | null;
  students: number;
  label: string;
};

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}

/**
 * Create a test in two steps: fill in, then check the preview and create.
 * Subject, class, section and stream come from the teacher's own assignment —
 * there is nothing to type and nothing outside their teaching to choose.
 */
/** `sectionId` pre-selects a class (from the dashboard's class switcher). */
export function ClassTestForm({ options, today, sectionId, syllabus = {} }: { options: TestOption[]; today: string; sectionId?: string; /** Syllabus entries per "sectionId:subjectId". */ syllabus?: Record<string, Array<{ id: string; label: string }>> }) {
  const [value, setValue] = useState((options.find((option) => option.sectionId === sectionId) ?? options[0])?.value ?? "");
  const [previewing, setPreviewing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", date: today, maxMarks: "25", description: "", syllabusItemId: "" });
  const chosen = options.find((option) => option.value === value) ?? options[0];
  const items = chosen ? (syllabus[`${chosen.sectionId}:${chosen.subjectId}`] ?? []) : [];
  const set = (key: keyof typeof draft) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setDraft((current) => ({ ...current, [key]: event.target.value }));

  function preview() {
    const max = Number(draft.maxMarks);
    if (!draft.name.trim()) return setProblem("Enter a test name.");
    if (!draft.date) return setProblem("Choose the test date.");
    if (!Number.isInteger(max) || max < 1 || max > 1000) return setProblem("Maximum marks must be a whole number from 1 to 1000.");
    setProblem(null);
    setPreviewing(true);
  }

  if (!chosen) return null;
  return (
    <ActionForm action={createClassTestAction} className="max-w-3xl">
      <input type="hidden" name="sectionId" value={chosen.sectionId} />
      <input type="hidden" name="subjectId" value={chosen.subjectId} />
      <input type="hidden" name="streamId" value={chosen.streamId ?? ""} />
      <input type="hidden" name="name" value={draft.name} />
      <input type="hidden" name="date" value={draft.date} />
      <input type="hidden" name="maxMarks" value={draft.maxMarks} />
      <input type="hidden" name="description" value={draft.description} />
      <input type="hidden" name="syllabusItemId" value={items.some((item) => item.id === draft.syllabusItemId) ? draft.syllabusItemId : ""} />

      {!previewing ? (
        <>
          <SelectField
            name="assignment"
            label="What are you testing?"
            hint="Only the subjects and classes you are assigned to teach are listed."
            value={value}
            onChange={(event) => setValue(event.target.value)}
            options={options.map((option) => ({ value: option.value, label: option.label }))}
            required
          />
          <dl className="bg-muted/50 grid grid-cols-2 gap-3 rounded-xl p-4 text-sm sm:grid-cols-4">
            <Fact label="Subject" value={chosen.subject} />
            <Fact label="Class" value={chosen.className} />
            <Fact label="Section" value={chosen.section} />
            <Fact label="Stream" value={chosen.stream ?? "Whole section"} />
          </dl>
          <FieldRow>
            <TextField name="_name" label="Test name" placeholder="Unit Test 2" value={draft.name} onChange={set("name")} maxLength={80} required />
            <TextField name="_date" label="Test date" type="date" value={draft.date} onChange={set("date")} required />
          </FieldRow>
          <FieldRow>
            <TextField name="_maxMarks" label="Maximum marks" type="number" min={1} max={1000} value={draft.maxMarks} onChange={set("maxMarks")} required />
            <div />
          </FieldRow>
          <TextareaField name="_description" label="Description (optional)" rows={2} placeholder="Chapters 3–5, short answers" value={draft.description} onChange={set("description")} maxLength={500} />
          {items.length ? (
            <SelectField name="_syllabusItemId" label="Unit, chapter or topic it tests (optional)" options={items.map((item) => ({ value: item.id, label: item.label }))} placeholder="Not linked" value={items.some((item) => item.id === draft.syllabusItemId) ? draft.syllabusItemId : ""} onChange={set("syllabusItemId")} hint="Linked tests show in the unit's progress report and in exam readiness." />
          ) : null}
          {problem ? (
            <p role="alert" className="text-destructive text-sm">
              {problem}
            </p>
          ) : null}
          <div>
            <Button type="button" onClick={preview}>
              Preview test
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="bg-primary-soft/60 ring-primary/20 flex flex-col gap-3 rounded-2xl p-5 ring-1">
            <p className="text-primary-strong text-xs font-semibold tracking-wide uppercase">Preview — check before creating</p>
            <p className="text-xl font-bold">{draft.name}</p>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <Fact label="Subject" value={chosen.subject} />
              <Fact label="Class & section" value={`${chosen.className} – ${chosen.section}`} />
              <Fact label="Stream" value={chosen.stream ?? "Whole section"} />
              <Fact label="Test date" value={new Date(`${draft.date}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })} />
              <Fact label="Maximum marks" value={draft.maxMarks} />
              <Fact label="Students" value={chosen.students} />
            </dl>
            {draft.description ? <p className="text-muted-foreground text-sm">{draft.description}</p> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <SubmitButton pendingLabel="Creating…">Create test</SubmitButton>
            <Button type="button" variant="ghost" onClick={() => setPreviewing(false)}>
              Back to edit
            </Button>
          </div>
        </>
      )}
    </ActionForm>
  );
}

/** Edit a test's name, date, maximum or description while its marks are a draft. */
export function EditTestForm({ test }: { test: { id: string; name: string; date: string; maxMarks: number; description: string | null } }) {
  return (
    <ActionForm action={updateClassTestAction}>
      <input type="hidden" name="assessmentId" value={test.id} />
      <FieldRow>
        <TextField name="name" label="Test name" defaultValue={test.name} maxLength={80} required />
        <TextField name="date" label="Test date" type="date" defaultValue={test.date} required />
      </FieldRow>
      <FieldRow>
        <TextField name="maxMarks" label="Maximum marks" type="number" min={1} max={1000} defaultValue={String(test.maxMarks)} required />
        <div />
      </FieldRow>
      <TextareaField name="description" label="Description (optional)" rows={2} defaultValue={test.description ?? ""} maxLength={500} />
      <div>
        <SubmitButton variant="outline">Save test details</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** School Admin: reopen submitted marks for a correction, with the reason recorded. */
export function ReopenMarksForm({ assessmentId }: { assessmentId: string }) {
  return (
    <ActionForm action={reopenMarksAction}>
      <input type="hidden" name="assessmentId" value={assessmentId} />
      <TextField name="reason" label="Why do these marks need correcting?" placeholder="Wrong marks entered for roll 12" maxLength={300} required />
      <div>
        <SubmitButton variant="outline">Reopen for correction</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** Withdraw published results — always with the reason. */
export function UnpublishExamForm({ examId }: { examId: string }) {
  return (
    <details className="relative">
      <summary className="border-input hover:bg-muted inline-flex h-9 cursor-pointer items-center rounded-md border px-3 text-sm font-medium">Unpublish…</summary>
      <ActionForm action={unpublishExamAction} className="bg-card absolute right-0 z-10 mt-2 w-80 gap-2 rounded-lg border p-3 shadow-lg">
        <input type="hidden" name="examId" value={examId} />
        <p className="text-xs">Students and parents stop seeing these results until they are verified and published again. For one wrong mark, use “Correct a published mark” instead.</p>
        <TextField name="reason" label="Why" placeholder="Maths marks entered for the wrong section" minLength={3} required />
        <SubmitButton size="sm" variant="destructive" pendingLabel="Withdrawing…">
          Withdraw results
        </SubmitButton>
      </ActionForm>
    </details>
  );
}

/** Correct one mark on published results, with the reason; the old and new value are logged. */
export function CorrectResultForm({ students, papers }: { students: Array<{ value: string; label: string }>; papers: Array<{ value: string; label: string }> }) {
  return (
    <ActionForm action={correctResultAction} className="gap-3">
      <FieldRow>
        <SelectField name="studentId" label="Student" options={students} placeholder="Choose…" required />
        <SelectField name="assessmentId" label="Subject" options={papers} placeholder="Choose…" required />
      </FieldRow>
      <FieldRow>
        <SelectField
          name="status"
          label="Result"
          options={[
            { value: "MARKS", label: "Marks" },
            { value: "ABSENT", label: "Absent" },
            { value: "EXEMPT", label: "Exempt" },
          ]}
          defaultValue="MARKS"
        />
        <TextField name="marks" label="Correct marks" type="number" min={0} step={1} hint="Leave blank for Absent or Exempt." />
      </FieldRow>
      <TextField name="reason" label="Reason" placeholder="Re-totalled the answer sheet" minLength={3} required />
      <div>
        <SubmitButton variant="outline" pendingLabel="Correcting…">
          Correct mark
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

/** Settings → Grading. */
export function GradingRulesForm({ bandsText, passPercent, usingDefault }: { bandsText: string; passPercent: number; usingDefault: boolean }) {
  return (
    <ActionForm action={saveGradingRulesAction} className="gap-4">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="useDefault" defaultChecked={usingDefault} className="accent-primary size-4" />
        Use the CBSE nine-point scale (A1 91–100 … E below 33)
      </label>
      <TextareaField name="bands" label="Your grades, highest first" rows={9} defaultValue={bandsText} hint={'One per line: "Grade: from %", e.g. "A+: 90". The last one must start at 0.'} />
      <TextField name="passPercent" label="Pass percentage" type="number" min={1} max={100} step={1} defaultValue={passPercent} hint="Used for any paper without its own pass mark, and for the final result." required />
      <div>
        <SubmitButton pendingLabel="Saving…">Save grading rules</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** The session's final result: which exams count and their weights (adding to 100). */
export function ResultSchemeForm({ name, componentsText }: { name: string; componentsText: string }) {
  return (
    <ActionForm action={saveResultSchemeAction} className="gap-3">
      <TextField name="name" label="Name" defaultValue={name} placeholder="Final result 2026-27" required />
      <TextareaField name="components" label="Exams and weights" rows={5} defaultValue={componentsText} hint={'One per line, "Exam name: weight". The weights must add up to 100, e.g. "Half-Yearly: 40" and "Annual: 60".'} required />
      <div>
        <SubmitButton pendingLabel="Saving…">Save final result</SubmitButton>
      </div>
    </ActionForm>
  );
}
