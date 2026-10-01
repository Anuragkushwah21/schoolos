import { apiRoute, apiSuccess, readJson, readQuery } from "@/server/api/handler";
import { roomListQuery, roomSchema } from "@/lib/validation/rooms";
import { createRoom, getRoom, listRooms } from "@/server/academics/rooms";

/** The school's rooms (`?q=`, `?type=`, `?status=active|inactive|all`). School Admin. */
export const GET = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx }) =>
  apiSuccess(await listRooms(ctx, readQuery(request, roomListQuery))),
);

/** Add a room. Names are unique per school, ignoring capitals and spaces. */
export const POST = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx }) => {
  const input = await readJson(request, roomSchema, { roomId: undefined });
  const id = await createRoom(ctx, input);
  return apiSuccess(await getRoom(ctx, id), { status: 201 });
});
