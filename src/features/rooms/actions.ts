"use server";

import { type ActionResult, parseFormData, successResult } from "@/lib/action-result";
import { pluralize } from "@/lib/format";
import { roomIdSchema, roomSchema, roomStatusSchema } from "@/lib/validation/rooms";
import { createRoom, deleteRoom, setRoomActive, updateRoom } from "@/server/academics/rooms";
import { requireTenantForAction } from "@/server/auth/current-user";
import { performAction } from "@/server/perform-action";

type Result = ActionResult<undefined>;

const REVALIDATE = { revalidate: ["/school-admin/academics/rooms", "/school-admin/timetable"] };

export async function saveRoomAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(async () => {
    const ctx = await requireTenantForAction("SCHOOL_ADMIN");
    const { roomId, ...input } = parseFormData(roomSchema, formData);
    if (roomId) {
      await updateRoom(ctx, roomId, { roomId, ...input });
      return successResult("Room saved.");
    }
    await createRoom(ctx, { roomId, ...input });
    return successResult("Room added.");
  }, REVALIDATE);
}

export async function setRoomActiveAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(async () => {
    const ctx = await requireTenantForAction("SCHOOL_ADMIN");
    const { roomId, active } = parseFormData(roomStatusSchema, formData);
    const inUse = await setRoomActive(ctx, roomId, active);
    if (active) return successResult("Room activated.");
    return successResult(
      inUse
        ? `Room deactivated. ${pluralize(inUse, "period")} this session still use it — move them in the timetable when you can.`
        : "Room deactivated.",
    );
  }, REVALIDATE);
}

export async function deleteRoomAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(async () => {
    const ctx = await requireTenantForAction("SCHOOL_ADMIN");
    const { roomId } = parseFormData(roomIdSchema, formData);
    await deleteRoom(ctx, roomId);
    return successResult("Room deleted.");
  }, REVALIDATE);
}
