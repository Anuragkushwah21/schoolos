import { z } from "zod";

import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { roomSchema } from "@/lib/validation/rooms";
import { deleteRoom, getRoom, setRoomActive, updateRoom } from "@/server/academics/rooms";

type Params = { roomId: string };

export const GET = apiRoute<Params>({ roles: ["SCHOOL_ADMIN"] }, async ({ ctx, params }) => apiSuccess(await getRoom(ctx, params.roomId)));

/** Replace a room's details. A rename is carried onto its timetable periods. */
export const PUT = apiRoute<Params>({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx, params }) => {
  const input = await readJson(request, roomSchema, { roomId: params.roomId });
  await updateRoom(ctx, params.roomId, input);
  return apiSuccess(await getRoom(ctx, params.roomId));
});

/** `{ "isActive": false }` deactivates: no new periods, existing ones keep it. */
export const PATCH = apiRoute<Params>({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx, params }) => {
  const { isActive } = await readJson(request, z.object({ isActive: z.boolean() }));
  const periodsThisSession = await setRoomActive(ctx, params.roomId, isActive);
  return apiSuccess({ ...(await getRoom(ctx, params.roomId)), periodsThisSession });
});

/** Only a room no period has ever used; otherwise 409 — deactivate it instead. */
export const DELETE = apiRoute<Params>({ roles: ["SCHOOL_ADMIN"] }, async ({ ctx, params }) => {
  await deleteRoom(ctx, params.roomId);
  return apiSuccess({ deleted: true });
});
