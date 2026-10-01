"use client";

import { ActionForm } from "@/components/forms/action-form";
import { FieldRow, SelectField, SubmitButton, TextField, TextareaField } from "@/components/forms/fields";
import { ROOM_TYPE_LABEL, ROOM_TYPES, type RoomTypeValue } from "@/lib/validation/rooms";

import { saveRoomAction } from "./actions";

const TYPE_OPTIONS = ROOM_TYPES.map((value) => ({ value, label: ROOM_TYPE_LABEL[value] }));

export type RoomFormValues = {
  id: string;
  name: string;
  type: RoomTypeValue;
  capacity: number | null;
  building: string | null;
  floor: string | null;
  description: string | null;
};

/** Add a room, or — with `room` — edit one. */
export function RoomForm({ room }: { room?: RoomFormValues }) {
  return (
    <ActionForm action={saveRoomAction} resetOnSuccess={!room}>
      {room ? <input type="hidden" name="roomId" value={room.id} /> : null}
      <FieldRow>
        <TextField name="name" label="Room number / name" placeholder="R101, Physics Lab" defaultValue={room?.name} maxLength={40} required />
        <SelectField name="type" label="Room type" options={TYPE_OPTIONS} defaultValue={room?.type ?? "CLASSROOM"} required />
      </FieldRow>
      <FieldRow>
        <TextField name="capacity" label="Capacity (seats)" type="number" min={1} max={1000} defaultValue={room?.capacity ?? undefined} />
        <TextField name="building" label="Building" placeholder="Main block" defaultValue={room?.building ?? undefined} maxLength={60} />
        <TextField name="floor" label="Floor" placeholder="Ground" defaultValue={room?.floor ?? undefined} maxLength={30} />
      </FieldRow>
      <TextareaField name="description" label="Description" rows={2} placeholder="Projector, 30 computers, wheelchair access…" defaultValue={room?.description ?? undefined} maxLength={500} />
      <p className="text-muted-foreground text-xs">
        Rooms are not tied to a class — each period in the timetable picks its room, and two periods cannot share one room at the same time.
      </p>
      <div>
        <SubmitButton>{room ? "Save room" : "Add room"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
