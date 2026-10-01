"use client";

import { ActionForm } from "@/components/forms/action-form";
import { FieldRow, SelectField, SubmitButton, TextField, TextareaField } from "@/components/forms/fields";

import { assignRegisterCoverAction, assignWorkCoverAction, saveAttendanceSettingsAction } from "./cover-actions";

type Option = { value: string; label: string };

/** Give one section's register, for one day, to a teacher. */
export function RegisterCoverForm({ sectionId, date, teachers, current }: { sectionId: string; date: string; teachers: Option[]; current?: string }) {
  return (
    <ActionForm action={assignRegisterCoverAction} className="flex-row flex-wrap items-end gap-2">
      <input type="hidden" name="sectionId" value={sectionId} />
      <input type="hidden" name="date" value={date} />
      <SelectField name="teacherId" label="Who takes attendance" options={teachers} defaultValue={current} placeholder="Choose a teacher" className="min-w-48 flex-1" required />
      <TextField name="reason" label="Note (optional)" placeholder="Class teacher on leave" className="min-w-40 flex-1" />
      <SubmitButton size="sm" variant={current ? "outline" : "default"} pendingLabel="Assigning…">
        {current ? "Change" : "Assign"}
      </SubmitButton>
    </ActionForm>
  );
}

/** Hand an absent staff member's work to a colleague for the day. */
export function WorkCoverForm({ date, staff, absentDefault }: { date: string; staff: Option[]; absentDefault?: string }) {
  return (
    <ActionForm action={assignWorkCoverAction} resetOnSuccess className="gap-3">
      <input type="hidden" name="date" value={date} />
      <FieldRow>
        <SelectField name="absentStaffMemberId" label="Who is away" options={staff} defaultValue={absentDefault} placeholder="Choose" required />
        <SelectField name="coverStaffMemberId" label="Who does their work" options={staff} placeholder="Choose" required />
      </FieldRow>
      <TextareaField name="duties" label="What to do" rows={2} placeholder="Open the library at 8:30, issue and return books, lock up at 3." required />
      <div>
        <SubmitButton size="sm" pendingLabel="Assigning…">
          Assign work
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

/** When the daily register is taken, and whether it submits itself. */
export function AttendanceSettingsForm({ timing, submission }: { timing: string; submission: string }) {
  return (
    <ActionForm action={saveAttendanceSettingsAction} className="gap-5">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Attendance timing</legend>
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" name="timing" value="FIRST_PERIOD" defaultChecked={timing === "FIRST_PERIOD"} className="accent-primary mt-1" />
          <span>
            First period
            <span className="text-muted-foreground block text-xs">Take attendance when the school day starts. It submits itself when the first period ends.</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" name="timing" value="LAST_PERIOD" defaultChecked={timing === "LAST_PERIOD"} className="accent-primary mt-1" />
          <span>
            Last period
            <span className="text-muted-foreground block text-xs">Take attendance during the final period. It submits itself when the last period ends.</span>
          </span>
        </label>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Attendance submission</legend>
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" name="submission" value="AUTO" defaultChecked={submission === "AUTO"} className="accent-primary mt-1" />
          <span>
            Automatic (recommended)
            <span className="text-muted-foreground block text-xs">
              Teachers just mark students — it is saved as they go and submitted for them at the end of the period. They can still submit early.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" name="submission" value="MANUAL" defaultChecked={submission === "MANUAL"} className="accent-primary mt-1" />
          <span>
            Teacher submits
            <span className="text-muted-foreground block text-xs">Marks are saved as a draft until the teacher presses Submit.</span>
          </span>
        </label>
      </fieldset>
      <p className="text-muted-foreground text-xs">
        Either way, a teacher can correct submitted attendance for 2 hours, and never after that day ends. After that, only you can correct it.
      </p>
      <div>
        <SubmitButton>Save</SubmitButton>
      </div>
    </ActionForm>
  );
}
