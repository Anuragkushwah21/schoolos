"use client";

import Link from "next/link";
import type { Route } from "next";

import { ActionForm } from "@/components/forms/action-form";
import { FieldRow, type SelectOption, SelectField, SubmitButton, TextField } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";

import { createSlotAction, updateSlotAction } from "./actions";

const DAY_OPTIONS: SelectOption[] = [
  { value: "MONDAY", label: "Monday" },
  { value: "TUESDAY", label: "Tuesday" },
  { value: "WEDNESDAY", label: "Wednesday" },
  { value: "THURSDAY", label: "Thursday" },
  { value: "FRIDAY", label: "Friday" },
  { value: "SATURDAY", label: "Saturday" },
];

export type SlotFormValues = {
  id: string;
  dayOfWeek: string;
  start: string;
  end: string;
  subjectId: string;
  teacherId: string;
  roomId: string | null;
  /** Lessons are recorded against it: only the room can change. */
  locked: boolean;
};

/** Add a period to a section — or, with `slot`, edit one. */
export function SlotForm({
  sectionId,
  subjects,
  teachers,
  rooms,
  slot,
  cancelHref,
}: {
  sectionId: string;
  subjects: SelectOption[];
  teachers: SelectOption[];
  rooms: SelectOption[];
  slot?: SlotFormValues;
  cancelHref?: Route;
}) {
  const locked = Boolean(slot?.locked);
  return (
    <ActionForm action={slot ? updateSlotAction : createSlotAction}>
      {slot ? <input type="hidden" name="slotId" value={slot.id} /> : <input type="hidden" name="sectionId" value={sectionId} />}
      {/* A locked period still submits its lesson fields, unchanged. */}
      {locked && slot ? (
        <>
          <input type="hidden" name="dayOfWeek" value={slot.dayOfWeek} />
          <input type="hidden" name="startMinute" value={slot.start} />
          <input type="hidden" name="endMinute" value={slot.end} />
          <input type="hidden" name="subjectId" value={slot.subjectId} />
          <input type="hidden" name="teacherId" value={slot.teacherId} />
        </>
      ) : null}
      <FieldRow>
        <SelectField name={locked ? "_day" : "dayOfWeek"} label="Day" options={DAY_OPTIONS} defaultValue={slot?.dayOfWeek} disabled={locked} required />
        <SelectField
          name="roomId"
          label="Room"
          options={rooms}
          placeholder={rooms.length ? "No room" : "No rooms added yet"}
          defaultValue={slot?.roomId ?? ""}
          hint={rooms.length ? undefined : "Add rooms under School Setup → Rooms."}
        />
      </FieldRow>
      <FieldRow>
        <TextField name={locked ? "_start" : "startMinute"} label="Starts" type="time" defaultValue={slot?.start ?? "09:00"} disabled={locked} required />
        <TextField name={locked ? "_end" : "endMinute"} label="Ends" type="time" defaultValue={slot?.end ?? "09:45"} disabled={locked} required />
      </FieldRow>
      <FieldRow>
        <SelectField name={locked ? "_subject" : "subjectId"} label="Subject" options={subjects} placeholder="Select…" defaultValue={slot?.subjectId} disabled={locked} required />
        <SelectField name={locked ? "_teacher" : "teacherId"} label="Teacher" options={teachers} placeholder="Select…" defaultValue={slot?.teacherId} disabled={locked} required />
      </FieldRow>
      <p className="text-muted-foreground text-xs">
        {locked
          ? "Lessons have been recorded for this period, so only its room can change."
          : "Clashes with this section's, the teacher's or the room's other periods are refused. The teacher is also assigned the subject for this section."}
      </p>
      <div className="flex gap-2">
        <SubmitButton>{slot ? "Save period" : "Add period"}</SubmitButton>
        {slot && cancelHref ? (
          <Button asChild variant="ghost">
            <Link href={cancelHref}>Cancel</Link>
          </Button>
        ) : null}
      </div>
    </ActionForm>
  );
}
