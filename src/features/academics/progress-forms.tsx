"use client";

import { ActionButton } from "@/components/forms/action-button";
import { ActionForm } from "@/components/forms/action-form";
import { FieldRow, SelectField, SubmitButton, TextField, TextareaField } from "@/components/forms/fields";

import { createReviewAction, deleteSyllabusItemAction, markUnitReadyAction, respondToReviewAction, saveSyllabusItemAction, saveThresholdAction, updateReviewAction } from "./progress-actions";

/**
 * Forms for academic progress. Plain serialised values in; every choice is
 * checked again on the server.
 */

type Level = "UNIT" | "CHAPTER" | "TOPIC";
const LEVEL_LABEL: Record<Level, string> = { UNIT: "unit", CHAPTER: "chapter", TOPIC: "topic" };

/** Add a unit, chapter or topic — or, with `item`, rename one (and set a unit's planned dates). */
export function SyllabusItemForm({ classId, subjectId, level, parentId, item, compact = false }: { classId: string; subjectId: string; level: Level; parentId: string | null; item?: { id: string; title: string; plannedFrom?: string; plannedTo?: string }; compact?: boolean }) {
  return (
    <ActionForm action={saveSyllabusItemAction} className={compact ? "flex-row flex-wrap items-end gap-2" : "gap-3"} resetOnSuccess={!item}>
      <input type="hidden" name="classId" value={classId} />
      <input type="hidden" name="subjectId" value={subjectId} />
      <input type="hidden" name="level" value={level} />
      {parentId ? <input type="hidden" name="parentId" value={parentId} /> : null}
      {item ? <input type="hidden" name="id" value={item.id} /> : null}
      <TextField name="title" label={item ? `Rename ${LEVEL_LABEL[level]}` : `New ${LEVEL_LABEL[level]}`} defaultValue={item?.title} required className="min-w-56" />
      {level === "UNIT" ? (
        <FieldRow>
          <TextField name="plannedFrom" label="Planned from" type="date" defaultValue={item?.plannedFrom ?? ""} />
          <TextField name="plannedTo" label="Planned to" type="date" defaultValue={item?.plannedTo ?? ""} hint="Used only to show a unit running behind." />
        </FieldRow>
      ) : null}
      <div>
        <SubmitButton size="sm" variant="outline" pendingLabel="Saving…">
          {item ? "Save" : `Add ${LEVEL_LABEL[level]}`}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export function DeleteSyllabusItemButton({ id, title }: { id: string; title: string }) {
  return (
    <ActionButton action={deleteSyllabusItemAction} fields={{ id }} variant="ghost" size="xs" confirm={{ title: `Remove "${title}"?`, description: "Only an entry with nothing inside it and nothing referring to it can be removed. Anything already used is kept — rename it instead.", confirmLabel: "Remove" }}>
      Remove
    </ActionButton>
  );
}

/** The School Admin's academic review threshold. */
export function ThresholdForm({ percent }: { percent: number }) {
  return (
    <ActionForm action={saveThresholdAction} className="flex-row flex-wrap items-end gap-2">
      <TextField name="percent" label="Flag tests averaging below (%)" type="number" min={1} max={100} defaultValue={percent} required className="w-48" />
      <SubmitButton size="sm" variant="outline" pendingLabel="Saving…">
        Save
      </SubmitButton>
    </ActionForm>
  );
}

const LEADER_ACTIONS = [
  { value: "REVISION_RECOMMENDED", label: "Recommend a revision class" },
  { value: "UPDATE_REQUESTED", label: "Ask the teacher for an update" },
  { value: "NOTE", label: "Add a note only" },
  { value: "RESOLVED", label: "Close — no action needed" },
];

/** A leader's review of a class and subject — from a low test, a unit, or on its own. */
export function LeaderReviewForm({ sectionId, subjectId, assessmentId, syllabusItemId, defaultAction = "NOTE" }: { sectionId: string; subjectId: string; assessmentId?: string; syllabusItemId?: string; defaultAction?: string }) {
  return (
    <ActionForm action={createReviewAction} className="gap-2">
      <input type="hidden" name="sectionId" value={sectionId} />
      <input type="hidden" name="subjectId" value={subjectId} />
      {assessmentId ? <input type="hidden" name="assessmentId" value={assessmentId} /> : null}
      {syllabusItemId ? <input type="hidden" name="syllabusItemId" value={syllabusItemId} /> : null}
      <SelectField name="action" label="Action" options={LEADER_ACTIONS} defaultValue={defaultAction} required />
      <TextareaField name="note" label="Note for the teacher" rows={2} hint="A low score is a reason to look, not a judgement of the teacher or the students." />
      <div>
        <SubmitButton size="sm" pendingLabel="Saving…">
          Save review
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export function UpdateReviewForm({ reviewId, readyUnit = false }: { reviewId: string; readyUnit?: boolean }) {
  return (
    <ActionForm action={updateReviewAction} className="gap-2">
      <input type="hidden" name="reviewId" value={reviewId} />
      <SelectField name="action" label="Action" options={readyUnit ? [{ value: "RESOLVED", label: "Reviewed — close" }, { value: "UPDATE_REQUESTED", label: "Ask the teacher for an update" }, { value: "REVISION_RECOMMENDED", label: "Recommend a revision class" }, { value: "NOTE", label: "Add a note only" }] : LEADER_ACTIONS} defaultValue={readyUnit ? "RESOLVED" : "NOTE"} required />
      <TextareaField name="note" label="Note" rows={2} />
      <div>
        <SubmitButton size="sm" variant="outline" pendingLabel="Saving…">
          Save
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

/** The teacher says a unit is taught and asks for review. */
export function MarkUnitReadyForm({ sectionId, subjectId, unitId }: { sectionId: string; subjectId: string; unitId: string }) {
  return (
    <ActionForm action={markUnitReadyAction} className="gap-2">
      <input type="hidden" name="sectionId" value={sectionId} />
      <input type="hidden" name="subjectId" value={subjectId} />
      <input type="hidden" name="unitId" value={unitId} />
      <TextareaField name="note" label="Note (optional)" rows={2} placeholder="All topics taught; test on Friday." />
      <div>
        <SubmitButton size="sm" pendingLabel="Sending…">
          Mark unit ready for review
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

/** The teacher's reply: what was done, a planned revision, the revision lesson and the follow-up test. */
export function RespondReviewForm({ reviewId, lessons, tests }: { reviewId: string; lessons: Array<{ value: string; label: string }>; tests: Array<{ value: string; label: string }> }) {
  return (
    <ActionForm action={respondToReviewAction} className="gap-2">
      <input type="hidden" name="reviewId" value={reviewId} />
      <TextareaField name="response" label="Your reply" rows={2} />
      <FieldRow>
        <TextField name="revisionPlannedOn" label="Revision planned on" type="date" />
        <SelectField name="revisionSessionId" label="Revision taught in" options={lessons} placeholder={lessons.length ? "Not yet" : "No recorded lesson yet"} />
      </FieldRow>
      <SelectField name="followUpAssessmentId" label="Follow-up test" options={tests} placeholder={tests.length ? "Not yet" : "No test yet"} hint="A test after the original one, to see whether the revision helped." />
      <div>
        <SubmitButton size="sm" pendingLabel="Saving…">
          Save reply
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
