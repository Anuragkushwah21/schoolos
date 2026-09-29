"use client";

import { useState } from "react";

import { ActionForm, useFormContext } from "@/components/forms/action-form";
import { CheckboxField, FieldRow, SubmitButton, TextField, TextareaField } from "@/components/forms/fields";
import { FieldError } from "@/components/shared/field-error";
import { DAY_LABEL } from "@/lib/dates";
import { ALL_DAYS } from "@/lib/validation/calendar";

import { saveHolidayAction, saveWeeklyOffsAction } from "./actions";

/**
 * A holiday is a date range from today onwards. Past days cannot be picked,
 * and the end date cannot be before the start date. The server enforces the
 * same rules, since `min` on a date input is only a hint to the picker.
 *
 * `earliestStart` is today, or a running holiday's own start date so it can be
 * edited without being forced to move.
 */
export function HolidayForm({
  holiday,
  today,
  earliestStart,
  defaultStartDate,
}: {
  holiday?: { id: string; title: string; description: string | null; startDate: string; endDate: string };
  today: string;
  earliestStart: string;
  /** Prefills "From" for a new holiday, e.g. the day clicked on the calendar. */
  defaultStartDate?: string;
}) {
  const [startDate, setStartDate] = useState(holiday?.startDate ?? defaultStartDate ?? "");
  const earliestEnd = startDate && startDate > today ? startDate : today;

  return (
    <ActionForm action={saveHolidayAction} className="max-w-3xl">
      {holiday ? <input type="hidden" name="holidayId" value={holiday.id} /> : null}
      <TextField name="title" label="Holiday name" placeholder="Diwali Holiday" defaultValue={holiday?.title} required />
      <FieldRow>
        <TextField
          name="startDate"
          label="From"
          type="date"
          defaultValue={holiday?.startDate ?? defaultStartDate}
          min={earliestStart}
          onChange={(event) => setStartDate(event.currentTarget.value)}
          hint="Today or a later date."
          required
        />
        <TextField
          name="endDate"
          label="To"
          type="date"
          defaultValue={holiday?.endDate}
          min={earliestEnd}
          hint="Leave blank for a one-day holiday."
        />
      </FieldRow>
      <TextareaField
        name="description"
        label="Reason or note"
        defaultValue={holiday?.description ?? ""}
        rows={3}
        hint="Optional. Shown to teachers, students and parents."
      />
      <CheckboxField
        name="clearAttendance"
        label="Clear attendance already recorded on these days"
        hint="Only needed when declaring a holiday on days that were already marked. Those marks are deleted so the holiday never counts as an absence."
      />
      <div>
        <SubmitButton>Save holiday</SubmitButton>
      </div>
    </ActionForm>
  );
}

function WeeklyOffFields({ selected }: { selected: readonly string[] }) {
  const { fieldErrors } = useFormContext();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium">Weekly offs</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {ALL_DAYS.map((day) => (
          <label key={day} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="weeklyOffDays"
              value={day}
              defaultChecked={selected.includes(day)}
              className="accent-primary size-4 rounded"
            />
            {DAY_LABEL[day]}
          </label>
        ))}
      </div>
      <p className="text-muted-foreground text-xs">
        Attendance is not expected on these days. A special working day can still be recorded.
      </p>
      <FieldError id="weeklyOffDays-error" messages={fieldErrors?.weeklyOffDays} />
    </fieldset>
  );
}

export function WeeklyOffsForm({ selected }: { selected: readonly string[] }) {
  return (
    <ActionForm action={saveWeeklyOffsAction}>
      <WeeklyOffFields selected={selected} />
      <div>
        <SubmitButton>Save weekly offs</SubmitButton>
      </div>
    </ActionForm>
  );
}
