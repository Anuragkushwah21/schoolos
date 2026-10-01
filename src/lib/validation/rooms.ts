import { z } from "zod";

import { checkbox, id, optionalInt, optionalText, requiredText } from "@/lib/validation/common";

export const ROOM_TYPES = ["CLASSROOM", "LAB", "COMPUTER_LAB", "LIBRARY", "HALL", "STAFF_ROOM", "SPORTS", "ACTIVITY", "OTHER"] as const;
export type RoomTypeValue = (typeof ROOM_TYPES)[number];

export const ROOM_TYPE_LABEL: Record<RoomTypeValue, string> = {
  CLASSROOM: "Classroom",
  LAB: "Science lab",
  COMPUTER_LAB: "Computer lab",
  LIBRARY: "Library",
  HALL: "Hall / auditorium",
  STAFF_ROOM: "Staff room",
  SPORTS: "Sports / games",
  ACTIVITY: "Music / art / activity",
  OTHER: "Other",
};

/** Add or edit a room. `roomId` is present only when editing. */
export const roomSchema = z.object({
  roomId: z.preprocess((value) => (value === "" ? undefined : value), id.optional()),
  name: requiredText("the room number or name", 40),
  type: z.enum(ROOM_TYPES, { error: "Choose a room type" }),
  capacity: optionalInt(1, 1000),
  building: optionalText(60),
  floor: optionalText(30),
  description: optionalText(500),
});
export type RoomInput = z.infer<typeof roomSchema>;

export const roomStatusSchema = z.object({ roomId: id, active: checkbox });
export const roomIdSchema = z.object({ roomId: id });

export const roomListQuery = z.object({
  q: z.string().trim().max(60).optional(),
  type: z.enum(ROOM_TYPES).optional().catch(undefined),
  status: z.enum(["active", "inactive", "all"]).optional().catch(undefined),
});
