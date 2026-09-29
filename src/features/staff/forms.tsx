"use client";

import { ActionForm } from "@/components/forms/action-form";
import { FieldRow, SelectField, SubmitButton, TextareaField, TextField } from "@/components/forms/fields";
import { nativeSelectClass } from "@/components/forms/styles";
import { Button } from "@/components/ui/button";
import { LEAVE_TYPES } from "@/lib/validation/leave";

import { applyLeaveAction, assignSubstituteAction } from "./actions";

const TYPE_LABEL: Record<(typeof LEAVE_TYPES)[number], string> = {
  CASUAL: "Casual",
  SICK: "Sick",
  EARNED: "Earned",
  MATERNITY: "Maternity",
  PATERNITY: "Paternity",
  UNPAID: "Unpaid",
  OTHER: "Other",
};

export const LEAVE_TYPE_OPTIONS = LEAVE_TYPES.map((value) => ({ value, label: TYPE_LABEL[value] }));

/** Up to 30 days back (sick leave filed on return) and 180 ahead; the server holds the same line. */
export function LeaveRequestForm({ min, max, today }: { min: string; max: string; today: string }) {
  return (
    <ActionForm action={applyLeaveAction} resetOnSuccess className="max-w-2xl">
      <SelectField name="type" label="Kind of leave" options={LEAVE_TYPE_OPTIONS} defaultValue="CASUAL" required />
      <FieldRow>
        <TextField name="startDate" label="From" type="date" min={min} max={max} defaultValue={today} required />
        <TextField name="endDate" label="To" type="date" min={min} max={max} defaultValue={today} required />
      </FieldRow>
      <TextareaField name="reason" label="Reason" rows={3} required />
      <div>
        <SubmitButton>Request leave</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** Choose who covers one period. Only teachers free at that time are offered. */
export function CoverForm({
  slotId,
  date,
  candidates,
}: {
  slotId: string;
  date: string;
  candidates: Array<{ id: string; name: string }>;
}) {
  if (!candidates.length) return <span className="text-muted-foreground text-xs">Nobody is free then</span>;
  return (
    <ActionForm action={assignSubstituteAction} className="flex-row items-center gap-2">
      <input type="hidden" name="timetableSlotId" value={slotId} />
      <input type="hidden" name="date" value={date} />
      <select name="teacherId" aria-label="Substitute teacher" className={nativeSelectClass} required>
        {candidates.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {candidate.name}
          </option>
        ))}
      </select>
      <Button type="submit" size="sm">
        Assign
      </Button>
    </ActionForm>
  );
}
